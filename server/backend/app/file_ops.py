"""Explicit single-file deletion, with a verified recoverable copy outside music."""
import asyncio
import hashlib
import hmac
import json
import os
import stat
import time
import uuid
from pathlib import Path, PurePosixPath

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .config import settings
from .navidrome import navidrome
from .library_match import library
from .sessions import destinations, identity, sessions


def music_root(metadata):
    if not settings.multi_user:
        return settings.music_library_directory
    matches = [d for d in destinations().values() if str(d['library_id']) == str(metadata.get('libraryId'))]
    if len(matches) != 1:
        raise HTTPException(403, 'Il file non appartiene a una tua libreria autorizzata.')
    return matches[0]['root']

lock = asyncio.Lock()


def source_path(metadata):
    root_value = music_root(metadata)
    raw = metadata.get('path', '')
    value = PurePosixPath(raw)
    if not raw or value.is_absolute() or '..' in value.parts or '\\' in raw:
        raise HTTPException(409, 'Percorso Navidrome non supportato: nessun file modificato.')
    prefix_value = '' if settings.multi_user else settings.navidrome_path_prefix
    prefix = PurePosixPath(prefix_value)
    try:
        relative = value.relative_to(prefix) if prefix_value else value
    except ValueError:
        raise HTTPException(409, 'Il brano non è nella cartella gestita da Metronomy.') from None
    try:
        root = Path(root_value).resolve(strict=True)
    except OSError:
        raise HTTPException(503, 'Cartella libreria non montata: aggiorna i volumi Docker.') from None
    candidate = root.joinpath(*relative.parts)
    try:
        cursor = root
        for part in relative.parts:
            cursor = cursor / part
            if cursor.is_symlink():
                raise ValueError()
        resolved = candidate.resolve(strict=True)
        if not resolved.is_relative_to(root) or candidate.is_symlink() or not resolved.is_file():
            raise ValueError()
    except (OSError, ValueError):
        raise HTTPException(409, 'File non trovato nella cartella gestita. Verifica NAVIDROME_PATH_PREFIX: nessun file modificato.') from None
    return resolved


def stamp(path):
    s = path.stat()
    return [s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns]


def confirmation(song_id, path, expires):
    owner = identity().id if settings.multi_user else ''
    payload = json.dumps([owner, song_id, str(path), stamp(path), expires], separators=(',', ':'))
    return hmac.new(settings.app_api_key.encode(), payload.encode(), hashlib.sha256).hexdigest()


def move_to_trash(source, metadata):
    root = Path(music_root(metadata)).resolve(strict=True)
    trash = Path(settings.music_trash_directory).resolve(strict=True)
    if trash.is_relative_to(root) or root.is_relative_to(trash):
        raise HTTPException(503, 'Il cestino deve essere fuori dalla cartella musicale.')
    before = stamp(source)
    entry_id = str(uuid.uuid4())
    entry = trash / entry_id
    entry.mkdir(mode=0o700)
    destination = entry / source.name
    manifest = {'songId': metadata['id'], 'title': metadata.get('title'), 'artist': metadata.get('artist'),
                'libraryId': metadata.get('libraryId'), 'albumId': metadata.get('albumId'), 'owner': identity().username if settings.multi_user else '',
                'originalRelativePath': str(source.relative_to(root)), 'filename': source.name,
                'deletedAt': time.time(), 'state': 'copying'}
    try:
        descriptor = os.open(source, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
        with os.fdopen(descriptor, 'rb') as incoming, destination.open('xb') as outgoing:
            if not stat.S_ISREG(os.fstat(incoming.fileno()).st_mode):
                raise OSError('Not a regular file')
            digest = hashlib.sha256()
            while block := incoming.read(1024 * 1024):
                outgoing.write(block)
                digest.update(block)
            outgoing.flush()
            os.fsync(outgoing.fileno())
        # Verify the saved file before removing the original, including cross-device copies.
        with destination.open('rb') as saved:
            if hashlib.file_digest(saved, 'sha256').hexdigest() != digest.hexdigest():
                raise OSError('Copy mismatch')
        if stamp(source) != before or not source.resolve(strict=True).is_relative_to(root):
            raise OSError('Source changed')
        manifest['sha256'] = digest.hexdigest()
        manifest['state'] = 'backup_verified'
        (entry / 'restore.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
        source.unlink()  # Only this selected file. Never recurse or delete covers/folders.
        manifest['state'] = 'trashed'
        (entry / 'restore.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
        return entry_id
    except OSError:
        # Preserve both source (if still present) and any copy for inspection/recovery.
        raise HTTPException(500, 'Operazione non completata: controlla file e cestino sul server. Nessuna cancellazione ricorsiva eseguita.') from None


class DeleteConfirmation(BaseModel):
    token: str
    expires: int


def router(auth):
    routes = APIRouter(prefix='/songs', dependencies=[Depends(auth)])

    async def locate(song_id):
        if not settings.app_api_key:
            raise HTTPException(503, 'APP_API_KEY obbligatoria per eliminare file.')
        data = await navidrome.real_song(song_id) if settings.multi_user else (await navidrome.json('getSong', {'id': song_id})).get('song', {})
        if not data.get('id'):
            raise HTTPException(404, 'Brano non trovato.')
        if not Path(settings.music_trash_directory).is_dir():
            raise HTTPException(503, 'Cestino non configurato: aggiorna i volumi Docker.')
        return data, source_path(data)

    @routes.get('/{song_id}/deletion')
    async def prepare(song_id: str):
        data, path = await locate(song_id)
        expires = int(time.time()) + 300
        return {'title': data.get('title'), 'artist': data.get('artist'), 'filename': path.name,
                'expires': expires, 'token': confirmation(song_id, path, expires)}

    @routes.post('/{song_id}/delete')
    async def delete(song_id: str, body: DeleteConfirmation):
        async with lock:
            data, path = await locate(song_id)
            if body.expires < time.time() or body.expires > time.time() + 300 or not hmac.compare_digest(body.token, confirmation(song_id, path, body.expires)):
                raise HTTPException(409, 'Conferma scaduta o file modificato. Riapri il menu e riprova.')
            entry_id = await asyncio.to_thread(move_to_trash, path, data)
            library.expires = 0
            for session in sessions.values():
                if session.index:
                    session.index.expires = 0
            try:
                await navidrome.json('startScan')
            except (RuntimeError, httpx.HTTPError, HTTPException):
                pass
            return {'status': 'trashed', 'trashId': entry_id, 'message': 'File spostato nel cestino recuperabile. Navidrome si aggiornerà dopo la scansione.'}

    return routes
