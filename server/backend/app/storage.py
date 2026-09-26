"""Account-scoped catalog totals and explicit, snapshot-confirmed trash removal."""
import hashlib
import hmac
import json
import time
import uuid
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException
from .config import settings
from .sessions import identity, destinations
from .library_match import library
from .navidrome import navidrome
from .file_ops import DeleteConfirmation, lock, stamp


def entries():
    user = identity()
    allowed = {str(d['library_id']) for d in destinations().values()}
    configured = Path(settings.music_trash_directory)
    if configured.is_symlink() or not configured.is_dir():
        raise HTTPException(503, 'Cestino non montato correttamente.')
    root = configured.resolve(strict=True)
    for d in destinations().values():
        music = Path(d['root']).resolve(strict=True)
        if root.is_relative_to(music) or music.is_relative_to(root):
            raise HTTPException(503, 'Cestino e libreria devono essere separati.')
    found = []
    for entry in root.iterdir():
        try:
            if str(uuid.UUID(entry.name)) != entry.name or entry.is_symlink() or not entry.is_dir():
                continue
            manifest = entry / 'restore.json'
            if manifest.is_symlink() or not manifest.is_file() or manifest.stat().st_size > 65536:
                continue
            raw = manifest.read_bytes()
            data = json.loads(raw)
            if data.get('state') != 'trashed' or str(data.get('libraryId')) not in allowed:
                continue
            if not user.admin and data.get('owner') != user.username:
                continue
            name = data.get('filename')
            if not isinstance(name, str) or name in ('', '.', '..', 'restore.json') or '/' in name or '\\' in name:
                continue
            target = entry / name
            if target.is_symlink() or not target.is_file() or set(p.name for p in entry.iterdir()) != {name, 'restore.json'}:
                continue
            found.append((target, manifest, [entry.name, name, stamp(target), stamp(manifest), hashlib.sha256(raw).hexdigest(), stamp(entry)]))
        except (OSError, ValueError, TypeError, AttributeError):
            continue  # Unknown or incomplete backups are preserved, never recursively deleted.
    return sorted(found, key=lambda e: e[2][0])


def signature(found, expires):
    if not settings.app_api_key:
        raise HTTPException(503, 'Chiave di conferma non configurata.')
    payload = json.dumps(['purge-trash', identity().id, expires, [e[2] for e in found]])
    return hmac.new(settings.app_api_key.encode(), payload.encode(), hashlib.sha256).hexdigest()


def router(auth):
    routes = APIRouter(prefix='/storage', dependencies=[Depends(auth)])

    @routes.get('')
    async def summary():
        songs = await library.read(fresh=True)
        artists = await navidrome.json('getArtists')
        artist_ids = {a['id'] for group in artists.get('artists', {}).get('index', []) for a in group.get('artist', [])}
        found = entries()
        return {'songs': len({s['id'] for s in songs}), 'albums': len({s['albumId'] for s in songs if s.get('albumId')}),
                'artists': len(artist_ids), 'trashCount': len(found), 'trashBytes': sum(e[2][2][2] for e in found),
                'canScan': identity().admin}

    @routes.post('/scan')
    async def scan():
        if not identity().admin:
            raise HTTPException(403, 'La scansione richiede un amministratore Navidrome.')
        await navidrome.json('startScan', {'fullScan': 'false'})
        return {'message': 'Scansione rapida richiesta. Aggiorna il riepilogo tra qualche secondo.'}

    @routes.get('/trash/confirmation')
    async def prepare():
        async with lock:
            found = entries()
            expires = int(time.time()) + 300
            return {'count': len(found), 'bytes': sum(e[2][2][2] for e in found), 'expires': expires, 'token': signature(found, expires)}

    @routes.post('/trash/empty')
    async def empty(body: DeleteConfirmation):
        async with lock:
            found = entries()
            if not time.time() <= body.expires <= time.time() + 300 or not hmac.compare_digest(body.token, signature(found, body.expires)):
                raise HTTPException(409, 'Cestino cambiato o conferma scaduta. Aggiorna e riprova.')
            removed = 0
            try:
                for target, manifest, snapshot in found:
                    if target.parent.is_symlink() or stamp(target.parent) != snapshot[5] or target.is_symlink() or manifest.is_symlink() or stamp(target) != snapshot[2] or stamp(manifest) != snapshot[3]:
                        raise OSError('Changed entry')
                    target.unlink()
                    manifest.unlink()
                    target.parent.rmdir()
                    removed += 1
            except OSError:
                raise HTTPException(409, f'Operazione interrotta: {removed} file eliminati definitivamente. Aggiorna il riepilogo.') from None
            return {'message': f'{removed} file eliminati definitivamente.', 'removed': removed}

    return routes
