from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
import asyncio

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, Field

from .config import settings
from .imports import import_queue
from .models import ImportRequest, ImportRequestCreate
from .navidrome import navidrome
from .lyrics_provider import lrclib, LyricsUnavailable
from . import network, file_ops, album_ops, storage, settings_info
from .sessions import authenticate as require_api_key, router as auth_router, username

@asynccontextmanager
async def lifespan(app):
    network.recover_jobs()
    task = asyncio.create_task(network.worker())
    yield
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task


app = FastAPI(title="Metronomy Bridge", version="0.1.0", lifespan=lifespan)


@app.exception_handler(RequestValidationError)
async def validation_error(request, error):
    # Pydantic's default payload can echo invalid login inputs, including passwords.
    return JSONResponse(status_code=422, content={'detail': 'Parametri non validi. Controlla i campi inseriti.'})


@app.middleware('http')
async def private_responses(request, call_next):
    response = await call_next(request)
    response.headers['Cache-Control'] = 'no-store'
    return response


app.include_router(auth_router)


def song(item: dict) -> dict:
    return {
        "id": item["id"], "title": item.get("title", "Untitled"),
        "artist": item.get("artist", "Unknown artist"), "album": item.get("album"),
        "duration": item.get("duration", 0), "coverArt": item.get("coverArt"),
        "track": item.get("track"), "year": item.get("year"),
        "albumId": item.get("albumId"), "artistId": item.get("artistId"),
        "starred": bool(item.get("starred")),
    }


app.include_router(network.router(require_api_key))
app.include_router(file_ops.router(require_api_key))
app.include_router(album_ops.router(require_api_key))
app.include_router(storage.router(require_api_key))
app.include_router(settings_info.router(require_api_key))


@app.get('/library/recent')
async def recent_listening(_: None = Depends(require_api_key)):
    data = await navidrome.json('getAlbumList2', {'type': 'recent', 'size': 24})
    return {'albums': data.get('albumList2', {}).get('album', [])}


@app.get('/library/songs')
async def library_songs(offset: int = Query(0, ge=0), _: None = Depends(require_api_key)):
    result = await navidrome.json('search3', {'query': '', 'songCount': '100', 'songOffset': str(offset), 'albumCount': '0', 'artistCount': '0'})
    items = result.get('searchResult3', {}).get('song', [])
    return {'songs': [song(item) for item in items], 'hasMore': len(items) == 100}


@app.get('/library/artists')
async def library_artists(_: None = Depends(require_api_key)):
    result = await navidrome.json('getArtists')
    artists = [artist for group in result.get('artists', {}).get('index', []) for artist in group.get('artist', [])]
    return {'artists': [{'id': a['id'], 'name': a['name'], 'albumCount': a.get('albumCount', 0)} for a in artists]}


@app.get('/library/favorites')
async def library_favorites(_: None = Depends(require_api_key)):
    result = await navidrome.json('getStarred2')
    return {'songs': [song({**item, 'starred': True}) for item in result.get('starred2', {}).get('song', [])], 'hasMore': False}


@app.get('/songs/{song_id}/offline-info')
async def offline_info(song_id: str, _: None = Depends(require_api_key)):
    item = (await navidrome.json('getSong', {'id': song_id})).get('song', {})
    suffix = str(item.get('suffix', '')).lower()
    if not item.get('id') or suffix not in ('flac', 'mp3', 'm4a', 'aac', 'wav', 'aiff', 'ogg', 'opus', 'alac'):
        raise HTTPException(409, 'Formato del file non supportato per il download locale.')
    return {'song': song(item), 'suffix': suffix, 'size': item.get('size', 0)}


@app.get('/offline/{song_id}')
async def offline_download(song_id: str, _: None = Depends(require_api_key)):
    response = await navidrome.download(song_id)
    content_type = response.headers.get('content-type', '').lower()
    if response.status_code != 200 or not (content_type.startswith('audio/') or content_type.split(';')[0] in ('application/octet-stream', 'application/ogg', 'application/flac')):
        await response.aclose()
        raise HTTPException(502, 'Download non disponibile. Verifica il permesso download di Navidrome.')
    return StreamingResponse(navidrome.bytes(response), media_type=content_type, headers=upstream_headers(response))


@app.get('/library/artists/{artist_id}')
async def library_artist(artist_id: str, _: None = Depends(require_api_key)):
    result = await navidrome.json('getArtist', {'id': artist_id})
    return {'albums': result.get('artist', {}).get('album', [])}


@app.get('/library/playlists')
async def library_playlists(_: None = Depends(require_api_key)):
    result = await navidrome.json('getPlaylists')
    return {'playlists': [{'id': p['id'], 'name': p['name'], 'songCount': p.get('songCount', 0)} for p in result.get('playlists', {}).get('playlist', [])]}


@app.get('/library/playlists/{playlist_id}')
async def library_playlist(playlist_id: str, _: None = Depends(require_api_key)):
    result = await navidrome.json('getPlaylist', {'id': playlist_id})
    return {'songs': [song(item) for item in result.get('playlist', {}).get('entry', [])]}


@app.get('/library/downloads')
async def library_downloads(offset: int = Query(0, ge=0), _: None = Depends(require_api_key)):
    from pathlib import Path
    from .library_match import library
    if settings.multi_user:
        result = await navidrome.native('song', {'_start': offset, '_end': offset + 100, '_sort': 'title', '_order': 'ASC'})
        if not isinstance(result, list):
            raise HTTPException(502, 'Risposta libreria non valida.')
        found = []
        for item in result:
            try:
                file_ops.source_path(item)
                found.append(song({**item, 'coverArt': item.get('albumId'), 'track': item.get('trackNumber')}))
            except HTTPException as error:
                if error.status_code not in (403, 409):
                    raise
        return {'songs': found, 'hasMore': len(result) == 100, 'nextOffset': offset + len(result)}
    if not Path(settings.music_library_directory).is_dir():
        raise HTTPException(503, 'Aggiorna il volume /library del bridge per verificare i file sul server.')
    accessible = await library.read()
    def existing_files():
        found = []
        for item in accessible:
            try:
                file_ops.source_path(item)
                found.append(item)
            except HTTPException:
                continue
        return found
    items = await asyncio.to_thread(existing_files)
    return {'songs': [song(item) for item in items[offset:offset + 100]], 'hasMore': offset + 100 < len(items)}


class Favorite(BaseModel):
    enabled: bool


@app.get('/songs/{song_id}')
async def song_detail(song_id: str, _: None = Depends(require_api_key)):
    item = (await navidrome.json('getSong', {'id': song_id})).get('song', {})
    return {'song': song(item), 'info': {key: item.get(key) for key in ('genre', 'year', 'bitRate', 'samplingRate', 'bitDepth', 'suffix', 'isrc', 'artists', 'albumArtists')}}


@app.post('/songs/{song_id}/favorite')
async def favorite(song_id: str, body: Favorite, _: None = Depends(require_api_key)):
    await navidrome.json('getSong', {'id': song_id})
    await navidrome.json('star' if body.enabled else 'unstar', {'id': song_id})
    return {'starred': body.enabled}


class PlaylistCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    song_id: str = Field(min_length=1, max_length=128)


@app.get('/playlists')
async def playlists(_: None = Depends(require_api_key)):
    items = (await navidrome.json('getPlaylists')).get('playlists', {}).get('playlist', [])
    return {'playlists': [{'id': p['id'], 'name': p['name']} for p in items if p.get('owner') == username()]}


@app.post('/playlists')
async def create_playlist(body: PlaylistCreate, _: None = Depends(require_api_key)):
    if not body.name.strip():
        raise HTTPException(422, 'Inserisci un nome per la playlist.')
    await navidrome.json('getSong', {'id': body.song_id})
    await navidrome.json('createPlaylist', {'name': body.name.strip(), 'songId': body.song_id})
    return {'status': 'ok'}


@app.post('/playlists/{playlist_id}/songs/{song_id}')
async def playlist_add(playlist_id: str, song_id: str, _: None = Depends(require_api_key)):
    playlist = (await navidrome.json('getPlaylist', {'id': playlist_id})).get('playlist', {})
    if playlist.get('owner') != username():
        raise HTTPException(403, 'Puoi modificare solo le tue playlist.')
    if not any(item.get('id') == song_id for item in playlist.get('entry', [])):
        await navidrome.json('getSong', {'id': song_id})
        await navidrome.json('updatePlaylist', {'playlistId': playlist_id, 'songIdToAdd': song_id})
    return {'status': 'ok'}


@app.get("/health")
async def health(_: None = Depends(require_api_key)) -> dict:
    payload = await navidrome.json("ping")
    return {"status": "ok", "navidrome": payload["status"]}


@app.get("/home")
async def home(_: None = Depends(require_api_key)) -> dict:
    newest, random = await navidrome.json("getAlbumList2", {"type": "newest", "size": "12"}), await navidrome.json("getRandomSongs", {"size": "12"})
    return {
        "recentAlbums": newest.get("albumList2", {}).get("album", []),
        "madeForYou": [song(item) for item in random.get("randomSongs", {}).get("song", [])],
    }


@app.get("/search")
async def search(q: str = Query(min_length=1), _: None = Depends(require_api_key)) -> dict:
    result = await navidrome.json("search3", {"query": q, "songCount": "30", "albumCount": "20", "artistCount": "20"})
    found = result.get("searchResult3", {})
    return {
        "artists": found.get("artist", []), "albums": found.get("album", []),
        "songs": [song(item) for item in found.get("song", [])],
    }


def upstream_headers(response: httpx.Response) -> dict[str, str]:
    allowed = {"accept-ranges", "content-length", "content-range", "content-type", "etag", "last-modified"}
    return {key: value for key, value in response.headers.items() if key.lower() in allowed}


@app.get('/albums')
async def albums(offset: int = Query(0, ge=0), sort: str = Query('alphabeticalByName', pattern='^(alphabeticalByName|newest)$'), _: None = Depends(require_api_key)) -> dict:
    result = await navidrome.json('getAlbumList2', {'type': sort, 'offset': str(offset), 'size': '50'})
    items = result.get('albumList2', {}).get('album', [])
    return {'albums': items, 'hasMore': len(items) == 50}


@app.get('/albums/{album_id}')
async def album_detail(album_id: str, _: None = Depends(require_api_key)) -> dict:
    result = await navidrome.json('getAlbum', {'id': album_id})
    album = result.get('album', {})
    return {'album': album, 'songs': [song(item) for item in album.get('song', [])]}


@app.get('/lyrics/{song_id}')
async def lyrics(song_id: str, _: None = Depends(require_api_key)) -> dict:
    # Resolve through Navidrome first, enforcing the current account's access.
    metadata = (await navidrome.json('getSong', {'id': song_id})).get('song', {})
    try:
        result = await navidrome.json('getLyricsBySongId', {'id': song_id})
    except RuntimeError:
        result = {}
    except HTTPException as error:
        if error.status_code in (401, 403):
            raise
        result = {}
    entries = (result.get('lyricsList') or {}).get('structuredLyrics') or []
    entries = [entry for entry in entries if any(line.get('value', '').strip() for line in entry.get('line', []))]
    if entries:
        return {'lyrics': entries, 'source': 'Navidrome', 'instrumental': False}
    try:
        return await lrclib.lookup(metadata)
    except LyricsUnavailable as error:
        raise HTTPException(status_code=503, detail=str(error)) from None


@app.get("/stream/{song_id}")
async def stream(song_id: str, request: Request, _: None = Depends(require_api_key)) -> StreamingResponse:
    response = await navidrome.stream(song_id, request.headers.get("range"))
    return StreamingResponse(navidrome.bytes(response), status_code=response.status_code, headers=upstream_headers(response), media_type=response.headers.get("content-type"))


@app.get("/cover/{cover_art_id}")
async def cover(cover_art_id: str, _: None = Depends(require_api_key)) -> StreamingResponse:
    response = await navidrome.cover(cover_art_id)
    return StreamingResponse(navidrome.bytes(response), status_code=response.status_code, headers=upstream_headers(response), media_type=response.headers.get("content-type"))


@app.post("/import-requests", response_model=ImportRequest, status_code=201)
async def create_import_request(request: ImportRequestCreate, _: None = Depends(require_api_key)) -> ImportRequest:
    if settings.multi_user:
        raise HTTPException(410, 'Usa la coda download personale in Cerca.')
    return import_queue.add(request)


@app.get("/import-requests", response_model=list[ImportRequest])
async def list_import_requests(_: None = Depends(require_api_key)) -> list[ImportRequest]:
    if settings.multi_user:
        raise HTTPException(410, 'Usa la coda download personale in Cerca.')
    return import_queue.all()
