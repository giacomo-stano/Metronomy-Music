"""LRCLIB fallback; only public track metadata leaves the server."""
import asyncio
import json
import re
import time
import unicodedata
from collections import OrderedDict
from email.utils import parsedate_to_datetime
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


class LyricsUnavailable(Exception):
    pass


def normalize(value):
    return ' '.join(unicodedata.normalize('NFKC', value or '').casefold().split())


def matches(record, song):
    try:
        duration = float(song.get('duration', 0))
        return (duration > 0 and abs(float(record['duration']) - duration) <= 2
                and normalize(record.get('trackName')) == normalize(song.get('title'))
                and normalize(record.get('artistName')) == normalize(song.get('artist')))
    except (TypeError, ValueError, KeyError):
        return False


def convert(record):
    if record.get('instrumental'):
        return {'lyrics': [], 'source': 'LRCLIB', 'instrumental': True}
    lines = []
    offset = 0
    for raw in (record.get('syncedLyrics') or '').splitlines():
        adjustment = re.search(r'\[offset:([+-]?\d+)\]', raw, re.I)
        if adjustment:
            offset = int(adjustment.group(1))
        stamps = list(re.finditer(r'\[(\d+):([0-5]\d)(?:\.(\d{1,3}))?\]', raw))
        if not stamps:
            continue
        value = raw[stamps[-1].end():].strip()
        for stamp in stamps:
            milliseconds = int((stamp.group(3) or '0').ljust(3, '0'))
            start = (int(stamp.group(1)) * 60 + int(stamp.group(2))) * 1000 + milliseconds
            lines.append({'start': start, 'value': value})
    synced = bool(lines)
    if synced:
        lines.sort(key=lambda line: line['start'])
    else:
        lines = [{'value': line} for line in (record.get('plainLyrics') or '').splitlines()]
    if not any(line['value'].strip() for line in lines):
        return {'lyrics': [], 'source': 'LRCLIB', 'instrumental': False}
    return {'lyrics': [{'synced': synced, 'offset': offset, 'line': lines,
                        'lang': 'und', 'source': 'LRCLIB'}],
            'source': 'LRCLIB', 'instrumental': False}


class LyricsProvider:
    def __init__(self):
        self.cache = OrderedDict()
        self.lock = asyncio.Lock()
        self.next_request = 0.0

    def fetch(self, endpoint, params):
        req = Request('https://lrclib.net/api/' + endpoint + '?' + urlencode(params),
                      headers={'User-Agent': 'Metronomy/0.2 (self-hosted)'})
        try:
            with urlopen(req, timeout=8) as response:
                return json.load(response)
        except HTTPError as error:
            if error.code == 404:
                return None
            if error.code == 429:
                retry = error.headers.get('Retry-After', '60')
                try:
                    seconds = float(retry)
                except ValueError:
                    try:
                        seconds = parsedate_to_datetime(retry).timestamp() - time.time()
                    except (ValueError, TypeError):
                        seconds = 60
                self.next_request = time.monotonic() + max(1, seconds)
            raise LyricsUnavailable('LRCLIB temporaneamente non disponibile. Riprova più tardi.') from None

    async def call(self, endpoint, params):
        remaining = self.next_request - time.monotonic()
        if remaining > 0.5:
            raise LyricsUnavailable('LRCLIB richiede una pausa. Riprova più tardi.')
        if remaining > 0:
            await asyncio.sleep(remaining)
        try:
            return await asyncio.to_thread(self.fetch, endpoint, params)
        except LyricsUnavailable:
            raise
        except Exception:
            raise LyricsUnavailable('Impossibile contattare LRCLIB. Riprova più tardi.') from None
        finally:
            self.next_request = max(self.next_request, time.monotonic() + 0.25)

    async def lookup(self, song):
        key = tuple(str(song.get(field) or '') for field in ('title', 'artist', 'album', 'duration'))
        async with self.lock:
            cached = self.cache.get(key)
            if cached and cached[0] > time.monotonic():
                self.cache.move_to_end(key)
                return cached[1]
            if not song.get('title') or not song.get('artist') or not song.get('duration'):
                return {'lyrics': [], 'source': None, 'instrumental': False}
            params = {'track_name': song['title'], 'artist_name': song['artist'],
                      'album_name': song.get('album') or '', 'duration': song['duration']}
            record = await self.call('get', params)
            if not isinstance(record, dict) or not matches(record, song):
                candidates = await self.call('search', {'track_name': song['title'], 'artist_name': song['artist']})
                compatible = [r for r in (candidates or []) if isinstance(r, dict) and matches(r, song)]
                compatible.sort(key=lambda r: (not bool(r.get('syncedLyrics')), normalize(r.get('albumName')) != normalize(song.get('album')), abs(float(r['duration']) - float(song['duration']))))
                record = compatible[0] if compatible else None
            result = convert(record) if record else {'lyrics': [], 'source': None, 'instrumental': False}
            ttl = 86400 if result['lyrics'] or result['instrumental'] else 600
            self.cache[key] = (time.monotonic() + ttl, result)
            self.cache.move_to_end(key)
            while len(self.cache) > 256:
                self.cache.popitem(last=False)
            return result


lrclib = LyricsProvider()
