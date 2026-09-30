"""Confirmed removal of an exact album track set, never a directory tree."""
import asyncio
import hashlib
import hmac
import json
import time
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, HTTPException
from .config import settings
from .navidrome import navidrome
from .sessions import identity, sessions
from .library_match import library
from . import file_ops


async def locate(album_id):
    if not settings.multi_user or not settings.app_api_key:
        raise HTTPException(503, 'Aggiorna e configura il bridge multiutente per eliminare album.')
    if not Path(settings.music_trash_directory).is_dir():
        raise HTTPException(503, 'Cestino non configurato.')
    album = (await navidrome.json('getAlbum', {'id': album_id})).get('album', {})
    tracks = album.get('song', [])
    if album.get('id') != album_id or not tracks:
        raise HTTPException(404, 'Album non trovato o vuoto.')
    # Navidrome can retain the old album count after a manual file removal.
    # Confirm only the returned track set; never infer or search for omitted files.
    declared = album.get('songCount')
    if type(declared) is not int or declared < len(tracks) or len(tracks) > 1000:
        raise HTTPException(409, 'Impossibile verificare tutti i brani dell’album: nessun file modificato.')
    entries, ids, paths, roots = [], set(), set(), set()
    for track in tracks:
        data = await navidrome.real_song(track['id'])
        if data.get('albumId') != album_id or data.get('id') in ids:
            raise HTTPException(409, 'Album incoerente: nessun file modificato.')
        path = file_ops.source_path(data)
        root = Path(file_ops.music_root(data)).resolve(strict=True)
        trash = Path(settings.music_trash_directory).resolve(strict=True)
        if path in paths or trash.is_relative_to(root) or root.is_relative_to(trash):
            raise HTTPException(409, 'Percorsi album o cestino non validi: nessun file modificato.')
        ids.add(data['id']); paths.add(path); roots.add((data.get('libraryId'), str(root)))
        entries.append((data, path, file_ops.stamp(path)))
    if len(roots) != 1:
        raise HTTPException(409, 'Album distribuito su più librerie: usa le azioni sui singoli brani.')
    return album, sorted(entries, key=lambda entry: entry[0]['id'])


def confirmation(album_id, entries, expires):
    manifest = [[data['id'], data['libraryId'], str(path), stamp] for data, path, stamp in entries]
    payload = json.dumps(['album', identity().id, album_id, manifest, expires], separators=(',', ':'))
    return hmac.new(settings.app_api_key.encode(), payload.encode(), hashlib.sha256).hexdigest()


def move_album(entries):
    removed, receipts, failure = [], [], False
    for data, path, expected in entries:
        try:
            # Check again immediately before each move. Do not continue on a failure.
            if file_ops.source_path(data) != path or file_ops.stamp(path) != expected:
                raise HTTPException(409, 'File modificato.')
            receipt = file_ops.move_to_trash(path, data)
            receipts.append({'songId': data['id'], 'trashId': receipt})
            removed.append(data['id'])
        except (HTTPException, OSError):
            # A verified backup can exist even if the final manifest write failed.
            if not path.exists():
                removed.append(data['id'])
            failure = True
            break
    return removed, receipts, failure


def router(auth):
    routes = APIRouter(prefix='/albums', dependencies=[Depends(auth)])

    @routes.get('/{album_id}/deletion')
    async def prepare(album_id: str):
        album, entries = await locate(album_id)
        expires = int(time.time()) + 300
        return {'title': album.get('name'), 'artist': album.get('artist'), 'count': len(entries),
                'catalogCount': album['songCount'],
                'warning': (f"Navidrome dichiara {album['songCount']} brani, ma ne restituisce {len(entries)}. Verranno rimossi soltanto i {len(entries)} file verificati. Aggiorna la scansione per riallineare il catalogo." if album['songCount'] != len(entries) else ''),
                'bytes': sum(stamp[2] for _, _, stamp in entries), 'expires': expires,
                'token': confirmation(album_id, entries, expires)}

    @routes.post('/{album_id}/delete')
    async def delete(album_id: str, body: file_ops.DeleteConfirmation):
        async with file_ops.lock:
            _, entries = await locate(album_id)
            if body.expires < time.time() or body.expires > time.time() + 300 or not hmac.compare_digest(body.token, confirmation(album_id, entries, body.expires)):
                raise HTTPException(409, 'Conferma scaduta o album modificato. Riapri il menu: nessun file modificato.')
            operation = asyncio.create_task(asyncio.to_thread(move_album, entries))
            try:
                removed, receipts, failed = await asyncio.shield(operation)
            except asyncio.CancelledError:
                # Keep the shared deletion lock until filesystem work has stopped.
                await operation
                raise
            library.expires = 0
            for session in sessions.values():
                if session.index:
                    session.index.expires = 0
            if removed:
                try:
                    await navidrome.json('startScan')
                except (RuntimeError, httpx.HTTPError, HTTPException):
                    pass
            return {'status': 'partial' if failed else 'trashed', 'removedSongIds': removed,
                    'receipts': receipts, 'total': len(entries),
                    'message': ('Operazione interrotta. Controlla il cestino e aggiorna la scansione prima di riprovare.' if failed else
                                'Brani spostati nel cestino recuperabile. Copertine, cartelle e altri file non sono stati eliminati.')}

    return routes
