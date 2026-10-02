"""Qobuz catalog and a serial, persistent qoget download queue.

No credentials or downloader output are returned to the phone. Only validated
catalog IDs reach the subprocess; no shell or user-selected filesystem paths.
"""
import asyncio
import json
import os
import shutil
import sqlite3
import time
import uuid
import re
from urllib.parse import urlsplit
from contextlib import contextmanager
from pathlib import Path
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from .config import settings
from .navidrome import navidrome
from .library_match import library, same_recording, text_key
from .sessions import current, identity, destinations, destination, refresh_access, sessions
from .lyrics_provider import lrclib, LyricsUnavailable


def credentials():
    try:
        data = json.loads(Path(settings.qoget_config).read_text())
        if not isinstance(data, dict) or not data.get('auth_token'):
            raise ValueError()
        return data
    except (OSError, ValueError):
        raise HTTPException(503, 'Configura qoget sul server: account mancante o configurazione non leggibile.') from None


_app_id = None
_app_id_lock = asyncio.Lock()


async def application_id(cfg):
    global _app_id
    if cfg.get('app_id'):
        return str(cfg['app_id'])
    async with _app_id_lock:
        if _app_id:
            return _app_id
        process = None
        try:
            process = await asyncio.create_subprocess_exec('metronomy-appid',
                env={**os.environ, 'QOGET_CONFIG': settings.qoget_config},
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
            output, _ = await asyncio.wait_for(process.communicate(), 25)
            value = output.decode().strip()
            if process.returncode or not value.isdigit():
                raise ValueError()
            _app_id = value
            return value
        except (OSError, ValueError, TimeoutError):
            raise HTTPException(503, 'Impossibile collegarsi a Qobuz. Verifica il login di qoget sul server.') from None
        finally:
            if process and process.returncode is None:
                process.kill()
                await process.wait()


async def catalog(endpoint, params):
    cfg = credentials()
    app_id = await application_id(cfg)
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.get('https://www.qobuz.com/api.json/0.2/' + endpoint,
                params={**params, 'app_id': app_id},
                headers={'X-App-Id': app_id, 'X-User-Auth-Token': cfg['auth_token']})
            response.raise_for_status()
            return response.json()
    except (httpx.HTTPError, ValueError):
        raise HTTPException(502, 'Qobuz non disponibile: verifica account qoget e riprova.') from None


def normalize(item, kind):
    if kind == 'artist':
        return {'id': str(item['id']), 'kind': kind, 'title': item.get('name', ''),
                'artist': item.get('name', ''), 'album': '', 'available': True,
                'cover': (item.get('image') or {}).get('large'), 'libraryMatch': None}
    album = item if kind == 'album' else item.get('album') or {}
    artist = item.get('performer') or album.get('artist') or {}
    title = item.get('title', '')
    if item.get('version'):
        title += ' (' + item['version'] + ')'
    return {'id': str(item['id']), 'kind': kind, 'title': title,
            'artist': artist.get('name', ''), 'album': album.get('title', ''),
            'duration': item.get('duration', 0), 'genre': (album.get('genre') or {}).get('name', ''),
            'cover': (album.get('image') or {}).get('large'),
            'available': bool(item.get('streamable')), 'previewable': bool(item.get('sampleable') or item.get('previewable')), 'libraryMatch': None}


async def duplicate(item, kind, fresh=False):
    songs = await library.read(fresh)
    if kind == 'track':
        return next((s for s in songs if same_recording(item, s)), None)
    tracks = (item.get('tracks') or {}).get('items', [])
    total = (item.get('tracks') or {}).get('total', item.get('tracks_count', len(tracks)))
    if not tracks or len(tracks) < total:
        raise HTTPException(503, 'Impossibile verificare tutti i brani dell’album. Cerca i brani singolarmente.')
    # Refuse whole-album imports if any track is already present. The user can
    # select individual missing tracks instead; never re-download existing ones.
    for track in tracks:
        track = {**track, 'album': item}
        match = next((s for s in songs if same_recording(track, s)), None)
        if match:
            return match
    return None


@contextmanager
def database():
    Path(settings.network_db).parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(settings.network_db)
    db.row_factory = sqlite3.Row
    db.execute('CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, target TEXT, title TEXT, status TEXT, message TEXT, created REAL)')
    columns = {row[1] for row in db.execute('PRAGMA table_info(jobs)')}
    for name in ('owner', 'destination', 'session_id'):
        if name not in columns:
            db.execute(f"ALTER TABLE jobs ADD COLUMN {name} TEXT NOT NULL DEFAULT ''")
    try:
        with db:
            yield db
    finally:
        db.close()


def jobs():
    with database() as db:
        if settings.multi_user:
            return [{k: row[k] for k in ('id', 'target', 'title', 'status', 'message', 'created', 'destination')}
                    for row in db.execute('SELECT * FROM jobs WHERE owner=? ORDER BY created DESC LIMIT 100', (identity().username,))]
        return [dict(row) for row in db.execute('SELECT * FROM jobs ORDER BY created DESC LIMIT 100')]


def update(job_id, status, message=''):
    with database() as db:
        db.execute('UPDATE jobs SET status=?,message=? WHERE id=?', (status, message, job_id))


def recover_jobs():
    # Never silently re-download a job interrupted by a container restart.
    with database() as db:
        db.execute("UPDATE jobs SET status='failed',message='Bridge riavviato: controlla i file e riprova.' WHERE status IN ('queued','downloading')")


async def worker():
    while True:
        with database() as db:
            row = db.execute("SELECT * FROM jobs WHERE status='queued' ORDER BY created LIMIT 1").fetchone()
        if not row:
            await asyncio.sleep(1)
            continue
        update(row['id'], 'downloading')
        process = None
        marker = None
        try:
            directory = settings.qoget_directory
            if settings.multi_user:
                user = next((s for s in sessions.values() if s.id == row['session_id'] and s.username == row['owner']), None)
                if user is None:
                    raise HTTPException(401, 'Sessione non più attiva.')
                marker = current.set(user)
                await refresh_access()
                directory = destination(row['destination'])['root']
                if not Path(directory).is_dir() or Path(directory).is_symlink():
                    raise HTTPException(503, 'Cartella non disponibile.')
            kind, item_id = row['target'].split(':', 1)
            metadata = await catalog(kind + '/get', {kind + '_id': item_id, 'limit': 500})
            if await duplicate(metadata, kind, fresh=True):
                update(row['id'], 'completed', 'Già in libreria: nessun file riscaricato.')
                continue
            env = {**os.environ, 'QOGET_CONFIG': settings.qoget_config}
            if settings.multi_user:
                # qoget history/config cache must not suppress a different user's download.
                env['XDG_CONFIG_HOME'] = '/data/qoget/' + row['destination']
                env['XDG_DATA_HOME'] = '/data/qoget/' + row['destination']
            flags = ['-no-db'] if settings.multi_user else []
            process = await asyncio.create_subprocess_exec('qoget', 'dl', '-d', directory, *flags,
                row['target'], env=env, stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
            if settings.multi_user:
                async with asyncio.timeout(7200):
                    while process.returncode is None:
                        identity()  # Logout/expiry cancels an active download within a second.
                        try:
                            await asyncio.wait_for(process.wait(), 1)
                        except TimeoutError:
                            continue
                code = process.returncode
            else:
                code = await asyncio.wait_for(process.wait(), timeout=7200)
            if code:
                update(row['id'], 'failed', 'qoget non ha completato il download. Verifica account, disponibilità e spazio sul server.')
            else:
                note = 'Scaricato. In attesa della scansione della libreria.'
                try:
                    await navidrome.json('startScan')
                    note = 'Scaricato. Scansione Navidrome richiesta: aggiorna la Libreria tra poco.'
                except (RuntimeError, httpx.HTTPError, HTTPException):
                    pass  # Non-admin accounts may not start a scan.
                update(row['id'], 'completed', note)
        except asyncio.CancelledError:
            if process and process.returncode is None:
                process.kill()
                await process.wait()
            update(row['id'], 'failed', 'Download interrotto dal riavvio del bridge.')
            raise
        except (OSError, TimeoutError, HTTPException, RuntimeError, httpx.HTTPError):
            if process and process.returncode is None:
                process.kill()
                await process.wait()
            update(row['id'], 'failed', 'Download interrotto o qoget non disponibile. Puoi riprovare.')
        finally:
            if marker is not None:
                current.reset(marker)


class Download(BaseModel):
    kind: Literal['track', 'album']
    id: str = Field(pattern=r'^[A-Za-z0-9]{1,64}$')
    destination: str | None = Field(default=None, pattern=r'^[A-Za-z0-9_]{1,64}$')


class ListenSeed(BaseModel):
    id: str = Field(min_length=1, max_length=100, pattern=r'^(qobuz:)?[A-Za-z0-9_-]+$')
    plays: int = Field(default=1, ge=1, le=1000)


class RecommendationRequest(BaseModel):
    seeds: list[ListenSeed] = Field(default_factory=list, max_length=12)


def valid_id(value, numeric=False):
    if not re.fullmatch(r'[0-9]{1,20}' if numeric else r'[A-Za-z0-9]{1,64}', value):
        raise HTTPException(422, 'ID Qobuz non valido.')
    return value


async def checked_items(raw, kind):
    items = [normalize(item, kind) for item in raw if item.get('id') is not None]
    if kind == 'artist':
        return items, True
    try:
        local = await library.read()
        for item, original in zip(items, [i for i in raw if i.get('id') is not None]):
            match = next((s for s in local if (same_recording(original, s) if kind == 'track' else
                text_key(item['title']) == text_key(s.get('album')) and text_key(item['artist']) == text_key(s.get('artist')))), None)
            if match:
                item['libraryMatch'] = match['id']
        return items, True
    except HTTPException as error:
        if error.status_code in (401, 403):
            raise
        return items, False


def network_song(raw):
    item = normalize(raw, 'track')
    return {'id': 'qobuz:' + item['id'], 'qobuzId': item['id'], 'title': item['title'],
            'artist': item['artist'], 'album': item['album'], 'duration': item['duration'],
            'genre': item['genre'], 'coverArt': item['cover']}


_stream_slots = asyncio.Semaphore(3)


async def full_stream(track_id):
    valid_id(track_id, True)
    credentials()
    process = None
    async with _stream_slots:
        try:
            process = await asyncio.create_subprocess_exec('metronomy-appid', 'stream', track_id,
                env={**os.environ, 'QOGET_CONFIG': settings.qoget_config}, stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL)
            output, _ = await asyncio.wait_for(process.communicate(), 30)
            data = json.loads(output)
            parsed = urlsplit(data.get('url', ''))
            if process.returncode or data.get('full') is not True or parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
                raise ValueError()
            return {'url': data['url']}
        except (OSError, ValueError, TimeoutError, TypeError, AttributeError):
            raise HTTPException(403, 'Riproduzione completa non disponibile. Verifica abbonamento Qobuz, disponibilità del brano e aggiornamento del bridge. Nessuna anteprima avviata.') from None
        finally:
            if process and process.returncode is None:
                process.kill()
                await process.wait()


def router(auth):
    routes = APIRouter(prefix='/network', dependencies=[Depends(auth)])

    @routes.get('/discover')
    async def discover():
        import random
        result = await catalog('album/getFeatured', {'type': 'best-sellers', 'limit': 50})
        items = [normalize(item, 'album') for item in (result.get('albums') or {}).get('items', [])]
        return {'items': random.sample(items, min(12, len(items)))}

    @routes.get('/status')
    async def status():
        try:
            credentials()
            roots = [d['root'] for d in destinations().values()] if settings.multi_user else [settings.qoget_directory]
            ready = bool(settings.app_api_key and shutil.which('qoget') and shutil.which('metronomy-appid')) and bool(roots) and all(Path(root).is_dir() for root in roots)
            return {'ready': ready, 'message': '' if ready else 'qoget o cartella musica non configurati nel bridge.'}
        except HTTPException as error:
            return {'ready': False, 'message': error.detail}

    @routes.get('/search')
    async def search(q: str = Query(min_length=1, max_length=200), kind: Literal['all', 'track', 'album', 'artist'] = 'all', offset: int = Query(0, ge=0, le=10000)):
        kinds = ['track', 'album', 'artist'] if kind == 'all' else [kind]
        async def group(k):
            result = await catalog(k + '/search', {'query': q, 'limit': 12, 'offset': offset})
            data = result.get(k + 's') or {}
            items, checked = await checked_items(data.get('items', []), k)
            return items, checked, offset + len(items) < data.get('total', 0)
        groups = await asyncio.gather(*(group(k) for k in kinds))
        return {'items': [i for items, _, _ in groups for i in items], 'hasMore': any(g[2] for g in groups),
                'nextOffset': offset + 12, 'libraryChecked': all(g[1] for g in groups)}

    @routes.get('/artist/{artist_id}')
    async def artist(artist_id: str, offset: int = Query(0, ge=0, le=10000)):
        result = await catalog('artist/get', {'artist_id': valid_id(artist_id, True), 'extra': 'albums', 'limit': 40, 'offset': offset})
        group = result.get('albums') or {}
        items, checked = await checked_items(group.get('items', []), 'album')
        return {'title': result.get('name', ''), 'items': items, 'libraryChecked': checked,
                'hasMore': offset + len(items) < group.get('total', 0), 'nextOffset': offset + 40}

    @routes.get('/album/{album_id}')
    async def album(album_id: str, offset: int = Query(0, ge=0, le=10000)):
        result = await catalog('album/get', {'album_id': valid_id(album_id), 'limit': 100, 'offset': offset})
        group = result.get('tracks') or {}
        items, checked = await checked_items([{**t, 'album': result} for t in group.get('items', [])], 'track')
        return {'title': result.get('title', ''), 'items': items, 'libraryChecked': checked,
                'hasMore': offset + len(items) < group.get('total', 0), 'nextOffset': offset + 100}

    @routes.get('/track/{track_id}')
    async def track(track_id: str):
        raw = await catalog('track/get', {'track_id': valid_id(track_id, True)})
        return {'song': network_song(raw)}

    @routes.get('/playback/{track_id}')
    async def playback(track_id: str):
        raw = await catalog('track/get', {'track_id': valid_id(track_id, True)})
        if not raw.get('streamable'):
            raise HTTPException(403, 'Brano non disponibile per la riproduzione completa con questo account Qobuz.')
        return await full_stream(track_id)

    @routes.get('/lyrics/{track_id}')
    async def track_lyrics(track_id: str):
        raw = await catalog('track/get', {'track_id': valid_id(track_id, True)})
        try:
            return await lrclib.lookup(network_song(raw))
        except LyricsUnavailable as error:
            raise HTTPException(503, str(error)) from None

    @routes.post('/recommendations')
    async def recommendations(body: RecommendationRequest):
        from .recommendations import recommend
        raw, genres = await recommend(body.seeds, catalog, navidrome, library)
        items, checked = await checked_items(raw, 'track')
        return {'items': items, 'genres': genres, 'personalized': bool(genres), 'libraryChecked': checked, 'hasMore': False}

    @routes.get('/preview/{track_id}')
    async def preview(track_id: str):
        if not track_id.isdigit() or len(track_id) > 20:
            raise HTTPException(422, 'ID brano non valido.')
        credentials()
        process = None
        try:
            process = await asyncio.create_subprocess_exec('metronomy-appid', 'preview', track_id,
                env={**os.environ, 'QOGET_CONFIG': settings.qoget_config}, stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL)
            output, _ = await asyncio.wait_for(process.communicate(), 30)
            data = json.loads(output)
            if process.returncode or not data.get('sample') or not str(data.get('url', '')).startswith('https://'):
                raise ValueError()
            return {'url': data['url'], 'duration': min(data.get('duration') or 30, 30)}
        except (OSError, ValueError, TimeoutError):
            raise HTTPException(404, 'Anteprima Qobuz non disponibile per questo brano.') from None
        finally:
            if process and process.returncode is None:
                process.kill()
                await process.wait()

    @routes.get('/downloads')
    async def downloads():
        return {'jobs': jobs()}

    @routes.post('/downloads', status_code=202)
    async def download(body: Download):
        owner, target_folder, session_id = '', '', ''
        directory = settings.qoget_directory
        if settings.multi_user:
            selected = destination(body.destination)
            target_folder = next(k for k, value in destinations().items() if value == selected)
            owner, session_id = identity().username, identity().id
            directory = selected['root']
        if not settings.app_api_key:
            raise HTTPException(503, 'Imposta APP_API_KEY prima di abilitare i download.')
        credentials()
        if not shutil.which('qoget') or not Path(directory).is_dir() or Path(directory).is_symlink():
            raise HTTPException(503, 'qoget o cartella musica non configurati nel bridge.')
        item = await catalog(body.kind + '/get', {body.kind + '_id': body.id, 'limit': 500})
        if not item.get('streamable'):
            raise HTTPException(409, 'Contenuto non disponibile per questo account.')
        if await duplicate(item, body.kind, fresh=True):
            raise HTTPException(409, 'Già nella tua libreria: download bloccato.' if body.kind == 'track' else 'Questo album contiene brani già in libreria. Cerca e scarica solo i brani mancanti.')
        target = body.kind + ':' + body.id
        with database() as db:
            if db.execute("SELECT id FROM jobs WHERE target=? AND owner=? AND destination=? AND status='completed'", (target, owner, target_folder)).fetchone():
                raise HTTPException(409, 'Già scaricato sul server. Attendi la scansione di Navidrome e aggiorna la Libreria.')
            existing = db.execute("SELECT * FROM jobs WHERE target=? AND owner=? AND destination=? AND status IN ('queued','downloading')", (target, owner, target_folder)).fetchone()
            if existing:
                return {k: existing[k] for k in ('id', 'target', 'title', 'status', 'message', 'created', 'destination')}
            count = db.execute("SELECT count(*) FROM jobs WHERE status IN ('queued','downloading')").fetchone()[0]
            if count >= 25:
                raise HTTPException(429, 'Coda piena: attendi il completamento dei download.')
            job = {'id': str(uuid.uuid4()), 'target': target, 'title': item.get('title', body.id), 'status': 'queued', 'message': '', 'created': time.time()}
            db.execute('INSERT INTO jobs (id,target,title,status,message,created,owner,destination,session_id) VALUES (:id,:target,:title,:status,:message,:created,:owner,:destination,:session_id)', {**job, 'owner': owner, 'destination': target_folder, 'session_id': session_id})
            job['destination'] = target_folder
        return job

    return routes
