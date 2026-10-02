"""Small, explainable per-user genre recommendations, not a shared Qobuz profile."""
import asyncio
import random
from collections import Counter
from fastapi import HTTPException
from .library_match import text_key


def genre_names(item):
    genre = item.get('genre') or ''
    if isinstance(genre, dict):
        genre = genre.get('name', '')
    values = [genre] + [g.get('name', '') for g in item.get('genres', []) if isinstance(g, dict)]
    return list(dict.fromkeys(g for g in values if isinstance(g, str) and g.strip()))


def genre_family(name):
    key = text_key(name)
    for family, words in {
        'electronic': ('electro', 'elettr', 'techno', 'house', 'dance'),
        'poprock': ('pop', 'rock', 'indie', 'alternative'),
        'hiphop': ('hiphop', 'rap'), 'classical': ('classical', 'classica', 'classique'),
        'jazz': ('jazz',), 'rnb': ('rnb', 'soul', 'funk'),
    }.items():
        if any(word in key for word in words):
            return family
    return key


def select_genres(weights, genres):
    scores = Counter()
    for genre in genres:
        if not isinstance(genre, dict) or genre.get('id') is None or not genre.get('name'):
            continue
        for name, weight in weights.items():
            if text_key(name) == text_key(genre['name']):
                scores[str(genre['id'])] += weight * 2
            elif genre_family(name) == genre_family(genre['name']):
                scores[str(genre['id'])] += weight
    return [next(g for g in genres if str(g.get('id')) == key) for key, _ in scores.most_common(3)]


async def recommend(seeds, catalog, navidrome, library):
    weights = Counter()
    # Resolve local seeds ONLY through the authenticated user's library index.
    local = {s['id']: s for s in await library.read()} if any(not s.id.startswith('qobuz:') for s in seeds) else {}
    slots = asyncio.Semaphore(3)
    async def fetch(endpoint, params):
        async with slots:
            return await catalog(endpoint, params)
    async def metadata(seed):
        if seed.id.startswith('qobuz:'):
            value = seed.id.removeprefix('qobuz:')
            if not value.isdigit() or len(value) > 20:
                return {}
            try:
                track = await fetch('track/get', {'track_id': value})
                return track.get('album') or {}
            except HTTPException:
                return {}
        return local.get(seed.id, {})
    for seed, item in zip(seeds, await asyncio.gather(*(metadata(s) for s in seeds))):
        for name in genre_names(item):
            weights[name] += seed.plays
    if not weights:
        try:
            recent = await navidrome.json('getAlbumList2', {'type': 'recent', 'size': '24'})
            for i, item in enumerate(recent.get('albumList2', {}).get('album', [])):
                for name in genre_names(item):
                    weights[name] += 1 / (1 + i / 4)
        except HTTPException as error:
            if error.status_code in (401, 403):
                raise
    selected = []
    if weights:
        result = await fetch('genre/list', {})
        group = result.get('genres') or {}
        genres = group.get('items', []) if isinstance(group, dict) else group
        selected = select_genres(weights, genres)
    async def featured(genre=None):
        params = {'type': 'best-sellers', 'limit': 20}
        if genre:
            params['genre_ids'] = str(genre['id'])
        result = await fetch('album/getFeatured', params)
        albums = (result.get('albums') or {}).get('items', [])
        return random.sample(albums, min(3 if selected else 8, len(albums)))
    groups = await asyncio.gather(*(featured(g) for g in selected)) if selected else [await featured()]
    albums = {str(a['id']): a for group in groups for a in group if a.get('id')}
    async def tracks(album):
        try:
            full = await fetch('album/get', {'album_id': album['id'], 'limit': 100})
            values = [{**t, 'album': full} for t in (full.get('tracks') or {}).get('items', []) if t.get('streamable')]
            return random.sample(values, min(3, len(values)))
        except HTTPException:
            return []
    results = [t for group in await asyncio.gather(*(tracks(a) for a in albums.values())) for t in group]
    results = list({str(t['id']): t for t in results if t.get('id')}.values())
    random.shuffle(results)
    return results[:24], [g['name'] for g in selected]
