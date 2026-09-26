import hashlib
import secrets
from collections.abc import AsyncIterator

import httpx
from fastapi import HTTPException
from urllib.parse import quote

from .config import settings
from .sessions import identity


class NavidromeClient:
    def __init__(self) -> None:
        self._client = httpx.AsyncClient(timeout=30.0, follow_redirects=False)

    def _params(self, extra: dict[str, str] | None = None) -> dict[str, str]:
        salt = secrets.token_hex(12)
        token = hashlib.md5(f"{settings.navidrome_password}{salt}".encode()).hexdigest()
        params = {
            "u": settings.navidrome_username,
            "t": token,
            "s": salt,
            "v": "1.16.1",
            "c": "metronomy-bridge",
            "f": "json",
        }
        if settings.multi_user:
            user = identity()
            params.update(u=user.username, t=user.digest, s=user.salt)
        if extra:
            params.update(extra)
        return params

    async def json(self, endpoint: str, params: dict[str, str] | None = None) -> dict:
        try:
            response = await self._client.get(
                f"{settings.navidrome_url.rstrip('/')}/rest/{endpoint}.view",
                params=self._params(params),
            )
            response.raise_for_status()
            payload = response.json()["subsonic-response"]
        except (httpx.HTTPError, ValueError, KeyError):
            # Never log an upstream URL containing Subsonic credentials.
            raise HTTPException(502, 'Navidrome non raggiungibile o risposta non valida.') from None
        if payload.get("status") != "ok":
            if settings.multi_user:
                code = payload.get('error', {}).get('code')
                raise HTTPException(401 if code in (40, 41) else 403 if code == 50 else 404 if code == 70 else 502,
                                    'Accesso Navidrome negato, contenuto non disponibile o sessione scaduta.')
            raise RuntimeError(payload.get("error", {}).get("message", "Navidrome error"))
        return payload

    async def native(self, endpoint, params=None):
        user = identity()
        try:
            response = await self._client.get(settings.navidrome_url.rstrip('/') + '/api/' + endpoint,
                params=params, headers={'X-ND-Authorization': 'Bearer ' + user.native_token})
            if response.status_code in (401, 403, 404):
                raise HTTPException(response.status_code, 'Accesso al file Navidrome negato o sessione scaduta.')
            response.raise_for_status()
            if response.headers.get('X-ND-Authorization'):
                user.native_token = response.headers['X-ND-Authorization'].removeprefix('Bearer ')
            return response.json()
        except (httpx.HTTPError, ValueError):
            raise HTTPException(502, 'Impossibile leggere il percorso reale da Navidrome.') from None

    async def real_song(self, song_id):
        data = await self.native('song/' + quote(song_id, safe=''))
        if not isinstance(data, dict) or data.get('id') != song_id:
            raise HTTPException(502, 'Metadati file non validi: nessuna modifica eseguita.')
        return data

    async def stream(self, song_id: str, range_header: str | None) -> httpx.Response:
        headers = {"range": range_header} if range_header else {}
        request = self._client.build_request(
            "GET",
            f"{settings.navidrome_url.rstrip('/')}/rest/stream.view",
            params=self._params({"id": song_id}),
            headers=headers,
        )
        try:
            return await self._client.send(request, stream=True)
        except httpx.HTTPError:
            raise HTTPException(502, 'Streaming Navidrome non disponibile.') from None

    async def cover(self, cover_art_id: str) -> httpx.Response:
        request = self._client.build_request(
            "GET",
            f"{settings.navidrome_url.rstrip('/')}/rest/getCoverArt.view",
            params=self._params({"id": cover_art_id}),
        )
        try:
            return await self._client.send(request, stream=True)
        except httpx.HTTPError:
            raise HTTPException(502, 'Copertina Navidrome non disponibile.') from None

    async def download(self, song_id: str) -> httpx.Response:
        request = self._client.build_request('GET', settings.navidrome_url.rstrip('/') + '/rest/download.view', params=self._params({'id': song_id}))
        try:
            return await self._client.send(request, stream=True)
        except httpx.HTTPError:
            raise HTTPException(502, 'Download Navidrome non disponibile.') from None

    @staticmethod
    async def bytes(response: httpx.Response) -> AsyncIterator[bytes]:
        try:
            async for chunk in response.aiter_bytes():
                yield chunk
        finally:
            await response.aclose()


navidrome = NavidromeClient()
