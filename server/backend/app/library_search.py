"""Paginated search in the current authenticated Navidrome library."""
import asyncio

from fastapi import HTTPException
from .library_visibility import visible_mask


async def search_page(client, kind, query, offset):
    key = 'song' if kind == 'songs' else 'album'
    page, cursor = [], offset
    for _ in range(20):
        result = await client.json('search3', {
            'query': query, 'artistCount': 0,
            'songCount': 101 if key == 'song' else 0,
            'albumCount': 101 if key == 'album' else 0,
            key + 'Offset': cursor,
        })
        found = result.get('searchResult3', {}) if isinstance(result, dict) else None
        items = found.get(key, []) if isinstance(found, dict) else None
        if not isinstance(items, list) or len(items) > 101 or any(
            not isinstance(item, dict) or not item.get('id') for item in items
        ):
            raise HTTPException(502, 'Risposta ricerca libreria non valida.')
        mask = await asyncio.to_thread(visible_mask, items) if key == 'song' else [True] * len(items)
        for item, visible in zip(items, mask):
            if visible and len(page) == 100:
                return page, True, cursor
            if visible:
                page.append(item)
            cursor += 1
        if len(items) < 101:
            return page, False, cursor
    if not page:
        raise HTTPException(503, 'Indice Navidrome non aggiornato: avvia una scansione e riprova.')
    return page, True, cursor
