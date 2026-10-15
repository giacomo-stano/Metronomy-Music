"""Album ownership is a recording-by-recording comparison, never a row count."""
import re

from fastapi import HTTPException
from .library_match import RecordingIndex


def total_tracks(album):
    value = (album.get('tracks') or {}).get('total', album.get('tracks_count'))
    return value if isinstance(value, int) and not isinstance(value, bool) and 0 < value <= 5000 else None


async def full_album(raw, fetch):
    album_id = str(raw.get('id', ''))
    if not re.fullmatch(r'[A-Za-z0-9]{1,64}', album_id):
        raise HTTPException(503, 'ID album non valido: nessun download avviato.')
    group = raw.get('tracks') or {}
    total = total_tracks(raw)
    if not total or group.get('offset', 0) != 0 or len(group.get('items', [])) != total:
        raw = await fetch('album/get', {'album_id': album_id, 'limit': 500, 'offset': 0})
        group = raw.get('tracks') or {}
        total = total_tracks(raw)
    if not total or str(raw.get('id', '')) != album_id or group.get('offset', 0) != 0:
        raise HTTPException(503, 'Impossibile verificare tutti i brani dell’album. Riprova.')
    tracks = list(group.get('items') or [])
    seen = {str(track.get('id', '')) for track in tracks}
    while len(tracks) < total:
        page = await fetch('album/get', {'album_id': album_id, 'limit': 500, 'offset': len(tracks)})
        batch = (page.get('tracks') or {}).get('items') or []
        if str(page.get('id', '')) != album_id or total_tracks(page) != total or not batch or any(str(t.get('id', '')) in seen for t in batch):
            raise HTTPException(503, 'Elenco brani incompleto: nessun download avviato.')
        tracks.extend(batch)
        seen.update(str(t.get('id', '')) for t in batch)
    if len(tracks) != total or len(seen) != total or any(not re.fullmatch(r'[0-9]{1,20}', str(t.get('id', ''))) for t in tracks):
        raise HTTPException(503, 'Elenco brani non verificabile: nessun download avviato.')
    return {**raw, 'tracks_count': total, 'tracks': {'items': tracks, 'total': total, 'offset': 0}}


def inventory(album, local):
    tracks = (album.get('tracks') or {}).get('items') or []
    total = total_tracks(album)
    if not total or len(tracks) != total:
        raise HTTPException(503, 'Elenco brani incompleto.')
    matches, missing = [], []
    index = local if isinstance(local, RecordingIndex) else RecordingIndex(local)
    for track in tracks:
        recording = {**track, 'album': album}
        match = index.match(recording)
        if match is None:
            missing.append(recording)
        else:
            matches.append(match)
    return {'libraryPresentCount': len(matches), 'libraryTotalCount': total,
            'libraryComplete': not missing, 'libraryMatch': matches[0]['id'] if matches else None,
            'missing': missing}
