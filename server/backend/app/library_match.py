"""Compare the accessible Navidrome library, never just a search result page."""
import asyncio
import time
import unicodedata

import httpx
from fastapi import HTTPException
from .navidrome import navidrome
from .config import settings
from .sessions import identity
from .library_visibility import available_songs


def text_key(value):
    return ''.join(c for c in unicodedata.normalize('NFKD', value or '').casefold() if c.isalnum())


def same_recording(remote, local):
    left = remote.get('isrc')
    right = local.get('isrc')
    if left and right:
        return text_key(left) in [text_key(v) for v in (right if isinstance(right, list) else [right])]
    artist = (remote.get('performer') or (remote.get('album') or {}).get('artist') or {}).get('name', '')
    title = remote.get('title', '')
    if remote.get('version'):
        title += ' (' + remote['version'] + ')'
    return bool(artist and title and remote.get('duration') and local.get('duration')) and (
        text_key(title) == text_key(local.get('title')) and text_key(artist) == text_key(local.get('artist'))
        and abs(remote['duration'] - local['duration']) <= 2)


class RecordingIndex:
    """Narrow candidates without changing same_recording's matching rules/order.

    Constructed from the current account's snapshot, never shared between users.
    """
    def __init__(self, songs):
        self.songs = songs
        self.isrcs = {}
        self.titles = {}
        for position, song in enumerate(songs):
            codes = song.get('isrc') or []
            for code in codes if isinstance(codes, list) else [codes]:
                self.isrcs.setdefault(text_key(code), set()).add(position)
            key = (text_key(song.get('artist')), text_key(song.get('title')))
            self.titles.setdefault(key, set()).add(position)

    def match(self, remote):
        artist = (remote.get('performer') or (remote.get('album') or {}).get('artist') or {}).get('name', '')
        title = remote.get('title', '')
        if remote.get('version'):
            title += ' (' + remote['version'] + ')'
        candidates = self.titles.get((text_key(artist), text_key(title)), set())
        if remote.get('isrc'):
            candidates = candidates | self.isrcs.get(text_key(remote['isrc']), set())
        return next((self.songs[i] for i in sorted(candidates) if same_recording(remote, self.songs[i])), None)


class LibraryIndex:
    def __init__(self):
        self.items = []
        self.expires = 0
        self.lock = asyncio.Lock()

    async def read(self, fresh=False):
        if settings.multi_user and self is library:
            user = identity()
            if user.index is None:
                user.index = LibraryIndex()
            return await user.index.read(fresh)
        async with self.lock:
            if not fresh and time.monotonic() < self.expires:
                return self.items
            try:
                async with asyncio.timeout(45):
                    items = []
                    for offset in range(0, 200000, 500):
                        result = await navidrome.json('search3', {'query': '', 'songCount': '500', 'songOffset': str(offset), 'albumCount': '0', 'artistCount': '0'})
                        if 'searchResult3' not in result:
                            raise RuntimeError('Missing library response')
                        batch = result.get('searchResult3', {}).get('song', [])
                        items.extend(await available_songs(batch))
                        if len(batch) < 500:
                            self.items, self.expires = items, time.monotonic() + 20
                            return items
                    raise RuntimeError('Incomplete index')
            except (RuntimeError, httpx.HTTPError, TimeoutError):
                raise HTTPException(503, 'Impossibile verificare tutta la libreria. Download sospeso: riprova tra poco.') from None

library = LibraryIndex()
