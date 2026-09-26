"""Per-request identities. No plaintext passwords or session tokens on disk.

Single uvicorn worker: sessions expire after eight hours and on bridge restart.
The fixed upstream URL is administrator configured, never supplied by a login.
"""
import hashlib
import json
import secrets
import time
from contextvars import ContextVar
from dataclasses import dataclass, field
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field, SecretStr
from .config import settings


@dataclass(repr=False, eq=False)
class Session:
    username: str
    salt: str
    digest: str
    native_token: str
    admin: bool
    folders: set[str]
    expires: float = field(default_factory=lambda: time.time() + 8 * 3600)
    id: str = field(default_factory=lambda: secrets.token_hex(16))
    index: object = None


current: ContextVar[Session | None] = ContextVar('metronomy_identity', default=None)
sessions: dict[str, Session] = {}
attempts: dict[str, list[float]] = {}


def policy():
    try:
        data = json.loads(Path(settings.accounts_file).read_text())
        if not isinstance(data['users'], dict) or not isinstance(data['destinations'], dict):
            raise ValueError()
        ids = []
        roots = []
        for key, dest in data['destinations'].items():
            if not key.isidentifier() or not str(dest['library_id']).isdigit():
                raise ValueError()
            root = Path(dest['root'])
            if not root.is_absolute() or str(root) in ('/', '/library', '/libraries'):
                raise ValueError()
            ids.append(str(dest['library_id']))
            roots.append(root.resolve())
        if len(set(ids)) != len(ids) or any(a.is_relative_to(b) or b.is_relative_to(a) for i, a in enumerate(roots) for b in roots[i+1:]):
            raise ValueError()
        return data
    except (OSError, ValueError, KeyError, TypeError):
        raise HTTPException(503, 'Configura accounts.json: utenti, ID librerie Navidrome e cartelle distinte.') from None


def identity():
    value = current.get()
    if value is None or value.expires <= time.time() or value not in sessions.values():
        raise HTTPException(401, 'Sessione scaduta. Accedi nuovamente.')
    return value


def username():
    return identity().username if settings.multi_user else settings.navidrome_username


def destinations():
    user = identity()
    cfg = policy()
    allowed = cfg['users'].get(user.username, [])
    return {key: dest for key, dest in cfg['destinations'].items()
            if key in allowed and str(dest['library_id']) in user.folders}


def destination(key=None):
    values = destinations()
    if key is None and len(values) == 1:
        return next(iter(values.values()))
    if key not in values:
        raise HTTPException(403, 'Scegli una destinazione autorizzata per questo account.')
    return values[key]


async def refresh_access():
    from .navidrome import navidrome
    user = identity()
    result = await navidrome.json('getMusicFolders')
    folders = {str(f['id']) for f in result.get('musicFolders', {}).get('musicFolder', [])}
    if folders != user.folders:
        user.index = None
    user.folders = folders
    # Fail closed if Navidrome unexpectedly grants this account extra libraries.
    cfg = policy()
    allowed = {str(d['library_id']) for k, d in cfg['destinations'].items() if k in cfg['users'].get(user.username, [])}
    if not user.folders or not user.folders.issubset(allowed):
        raise HTTPException(403, 'Le librerie autorizzate in Navidrome non corrispondono ad accounts.json.')


async def authenticate(request: Request, authorization: str | None = Header(None),
                       access_token: str | None = Query(None), x_api_key: str | None = Header(None)):
    if not settings.multi_user:
        if not settings.app_api_key or (x_api_key or access_token) != settings.app_api_key:
            raise HTTPException(401, 'Invalid API key')
        yield
        return
    bearer = authorization[7:] if authorization and authorization.startswith('Bearer ') else None
    # URL tokens are accepted only by media endpoints, never by mutation APIs.
    token = bearer or (access_token if request.url.path.startswith(('/cover/', '/stream/')) else None)
    user = sessions.get(hashlib.sha256((token or '').encode()).hexdigest())
    if user is None or user.expires <= time.time():
        raise HTTPException(401, 'Sessione scaduta. Accedi nuovamente.')
    marker = current.set(user)
    try:
        if request.url.path != '/auth/logout':
            await refresh_access()
        yield user
    finally:
        current.reset(marker)


class Login(BaseModel):
    username: str = Field(min_length=1, max_length=128)
    password: SecretStr = Field(min_length=1, max_length=1024)


def public_user():
    user = identity()
    return {'username': user.username, 'admin': user.admin, 'expires': user.expires,
            'destinations': [{'id': key, 'label': value.get('label', key)} for key, value in destinations().items()]}


router = APIRouter(prefix='/auth')


@router.post('/login')
async def login(body: Login, request: Request, response: Response):
    if not settings.multi_user:
        raise HTTPException(503, 'Abilita MULTI_USER sul bridge.')
    now = time.time()
    for key in list(attempts):
        attempts[key] = [t for t in attempts[key] if t > now - 60]
        if not attempts[key]:
            del attempts[key]
    peer = request.client.host if request.client else 'unknown'
    if len(attempts.get(peer, [])) >= 10 or sum(map(len, attempts.values())) >= 200:
        raise HTTPException(429, 'Troppi tentativi. Attendi un minuto.')
    attempts.setdefault(peer, []).append(now)
    cfg = policy()
    name = body.username.strip()
    if name not in cfg['users']:
        raise HTTPException(401, 'Credenziali non valide o account non abilitato.')
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=False) as client:
            result = await client.post(settings.navidrome_url.rstrip('/') + '/auth/login',
                                       json={'username': name, 'password': body.password.get_secret_value()})
            if result.status_code in (401, 403):
                raise HTTPException(401, 'Credenziali non valide o account non abilitato.')
            result.raise_for_status()
            data = result.json()
            if not data.get('token') or data.get('username') != name:
                raise ValueError()
    except (httpx.HTTPError, ValueError):
        raise HTTPException(502, 'Login Navidrome non disponibile. Verifica URL e versione del server.') from None
    for key in list(sessions):
        if sessions[key].expires <= now:
            del sessions[key]
    if len(sessions) >= 100:
        raise HTTPException(429, 'Troppe sessioni attive.')
    salt = secrets.token_hex(16)
    user = Session(name, salt, hashlib.md5((body.password.get_secret_value() + salt).encode()).hexdigest(),
                   data['token'], bool(data.get('isAdmin')), set())
    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    sessions[token_hash] = user
    marker = current.set(user)
    try:
        await refresh_access()
        response.headers['Cache-Control'] = 'no-store'
        return {'token': token, **public_user()}
    except Exception:
        sessions.pop(token_hash, None)
        raise
    finally:
        current.reset(marker)


@router.get('/me', dependencies=[Depends(authenticate)])
async def me():
    return public_user()


@router.post('/logout', dependencies=[Depends(authenticate)])
async def logout():
    user = identity()
    for key, value in list(sessions.items()):
        if value is user:
            del sessions[key]
    return {'status': 'ok'}
