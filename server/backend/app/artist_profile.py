"""Artist-page projection. No credentials, guessed rankings or Apple-only editorial data."""
import asyncio
import re
from html import unescape

from fastapi import HTTPException


def display_name(value):
    return str(value.get('display') or '') if isinstance(value, dict) else str(value or '')


def legacy_item(raw):
    """The artist/page API uses rights/dates/name.display, unlike artist/get."""
    item = dict(raw)
    for key in ('artist', 'performer'):
        if isinstance(item.get(key), dict):
            item[key] = {**item[key], 'name': display_name(item[key].get('name'))}
    if item.get('artist') and not item.get('performer'):
        item['performer'] = item['artist']
    if isinstance(item.get('album'), dict):
        item['album'] = legacy_item(item['album'])
    if isinstance(item.get('rights'), dict):
        item.update(item['rights'])
    item['release_date_original'] = item.get('release_date_original') or (item.get('dates') or {}).get('original')
    return item


def plain_text(value):
    if not isinstance(value, str):
        return ''
    value = re.sub(r'<(script|style)\b[^>]*>.*?</\1>', '', value, flags=re.I | re.S)
    value = re.sub(r'<(?:br\s*/?|/p|/div)>', '\n', value, flags=re.I)
    return unescape(re.sub(r'<[^>]+>', '', value)).strip()[:20000]


async def build_profile(artist_id, catalog, checked_items, normalize):
    partial = []

    async def optional(endpoint, params, label):
        try:
            return await catalog(endpoint, params)
        except HTTPException as error:
            if error.status_code in (401, 403):
                raise
            partial.append(label)
            return {}

    legacy, page, similar = await asyncio.gather(
        catalog('artist/get', {'artist_id': artist_id, 'extra': 'albums', 'limit': 40, 'offset': 0}),
        optional('artist/page', {'artist_id': artist_id, 'extra': 'topTracks', 'sort': 'release_date', 'order': 'desc'}, 'Informazioni aggiuntive'),
        optional('artist/getSimilarArtists', {'artist_id': artist_id, 'limit': 12}, 'Artisti simili'),
    )
    artist = normalize({**legacy, 'id': artist_id, 'name': display_name(legacy.get('name') or page.get('name'))}, 'artist')
    biography = page.get('biography') or legacy.get('biography') or {}
    if isinstance(biography, str):
        biography = {'content': biography}
    artist['biography'] = plain_text(biography.get('content') or biography.get('summary'))
    artist['biographySource'] = plain_text(biography.get('source'))

    raw_albums = (legacy.get('albums') or {}).get('items', [])
    albums, checked = await checked_items(raw_albums, 'album')
    releases = []
    labels = {'album': 'Album', 'epSingle': 'Singoli e EP', 'live': 'Album dal vivo',
              'compilation': 'Raccolte', 'other': 'Collaborazioni'}
    for group in page.get('releases') or []:
        key = group.get('type')
        if key not in labels:
            continue
        items, ok = await checked_items([legacy_item(i) for i in group.get('items', [])], 'album')
        checked = checked and ok
        if items:
            releases.append({'id': key, 'title': labels[key], 'items': items})
    if not releases and albums:
        # Legacy does not reliably classify EPs or collaborations: do not guess.
        releases = [{'id': 'album', 'title': 'Album', 'items': albums}]

    top_raw = page.get('top_tracks') or []
    if isinstance(top_raw, dict):
        top_raw = top_raw.get('items', [])
    slots = asyncio.Semaphore(3)

    async def hydrate(raw):
        if not isinstance(raw, dict) or not re.fullmatch(r'[0-9]{1,20}', str(raw.get('id', ''))):
            return None
        item = legacy_item(raw)
        if not item.get('album') or not item.get('performer') or 'streamable' not in item:
            async with slots:
                try:
                    item = await asyncio.wait_for(optional('track/get', {'track_id': str(raw['id'])}, 'Top brani'), timeout=8)
                except TimeoutError:
                    partial.append('Top brani')
                    return None
        return item if item.get('id') is not None else None

    hydrated = await asyncio.gather(*(hydrate(i) for i in top_raw[:20]))
    top, ok = await checked_items([i for i in hydrated if i], 'track')
    checked = checked and ok
    seen = set()
    top = [i for i in top if not (i['id'] in seen or seen.add(i['id']))]
    related, _ = await checked_items((similar.get('artists') or {}).get('items', []), 'artist')
    latest = page.get('last_release') or legacy.get('album_last_release')
    latest_items, ok = await checked_items([legacy_item(latest)] if latest and latest.get('id') else [], 'album')
    checked = checked and ok
    if not latest_items:
        dated = [i for i in albums if i.get('releaseDate')]
        latest_items = sorted(dated, key=lambda i: i['releaseDate'], reverse=True)[:1]
    # These are Qobuz popularity rankings, not Apple's editorial "essential" albums.
    ranked = [i for i in raw_albums if isinstance(i.get('popularity'), (int, float)) and i['popularity'] > 0]
    principal, ok = await checked_items(sorted(ranked, key=lambda i: i['popularity'], reverse=True)[:2], 'album')
    return {'artist': artist, 'topTracks': top, 'latestRelease': latest_items[0] if latest_items else None,
            'principalAlbums': principal, 'releases': releases, 'similarArtists': related,
            'libraryChecked': checked and ok, 'partial': list(dict.fromkeys(partial)),
            'albums': {'items': albums, 'hasMore': len(raw_albums) < (legacy.get('albums') or {}).get('total', 0),
                       'nextOffset': 40, 'libraryChecked': checked}}
