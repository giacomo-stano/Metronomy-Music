"""Read-only visibility checks while Navidrome's asynchronous scan catches up.

Never search other users' folders or infer absence from an unavailable mount.
The native catalog remains the authorization boundary; this only removes rows.
"""
import asyncio
from pathlib import Path, PurePosixPath

from fastapi import HTTPException
from .config import settings
from .sessions import destinations


def visible_mask(items):
    roots = None
    resolved_roots = {}

    def present(item):
        nonlocal roots
        if str(item.get('missing', '')).lower() in ('true', '1'):
            return False
        raw = item.get('path')
        if not isinstance(raw, str) or not raw:
            return True  # Subsonic responses may omit physical metadata.
        relative = PurePosixPath(raw)
        if relative.is_absolute() or '..' in relative.parts or '\\' in raw:
            return True  # Never probe an untrusted/out-of-root path.
        if settings.multi_user:
            library_id = item.get('libraryId')
            if library_id is None:
                return True
            if roots is None:
                roots = {str(d['library_id']): d['root'] for d in destinations().values()}
            root_value = roots.get(str(library_id))
            if root_value is None:
                return True  # Do not infer a path from a different library.
        else:
            root_value = settings.music_library_directory
            if settings.navidrome_path_prefix:
                try:
                    relative = relative.relative_to(PurePosixPath(settings.navidrome_path_prefix))
                except ValueError:
                    return True
        if root_value not in resolved_roots:
            try:
                root = Path(root_value).resolve(strict=True)
                resolved_roots[root_value] = root if root.is_dir() else None
            except OSError:
                resolved_roots[root_value] = None
        root = resolved_roots[root_value]
        if root is None:
            return True  # A missing Docker mount is not an empty library.
        cursor = root
        try:
            for part in relative.parts:
                cursor = cursor / part
                if cursor.is_symlink():
                    return True  # Do not follow links outside a managed root.
                cursor.stat()
            return cursor.is_file()
        except (FileNotFoundError, NotADirectoryError):
            return False
        except OSError:
            return True  # Permission/IO errors do not prove deletion.

    return [present(item) for item in items]


async def available_songs(items):
    mask = await asyncio.to_thread(visible_mask, items)
    return [item for item, visible in zip(items, mask) if visible]


async def native_song_page(client, offset, sort):
    """Fill pages after filtering, retaining the upstream cursor (not row count)."""
    field = 'createdAt' if sort in ('newest', 'oldest') else sort
    page, cursor = [], offset
    # Bound IO on badly stale indexes, but leave a continuation for the next page.
    for _ in range(20):
        items = await client.native('song', {
            '_start': cursor, '_end': cursor + 101,
            '_sort': field, '_order': 'DESC' if sort == 'newest' else 'ASC',
            'missing': 'false',
        })
        if not isinstance(items, list) or len(items) > 101 or any(not isinstance(i, dict) or not i.get('id') for i in items):
            raise HTTPException(502, 'Risposta libreria non valida.')
        mask = await asyncio.to_thread(visible_mask, items)
        for item, visible in zip(items, mask):
            if visible and len(page) == 100:
                return page, True, cursor  # Lookahead is NOT consumed.
            if visible:
                page.append(item)
            cursor += 1
        if len(items) < 101:
            return page, False, cursor
    if not page:
        raise HTTPException(503, 'Indice Navidrome non aggiornato: avvia una scansione e riprova.')
    return page, True, cursor
