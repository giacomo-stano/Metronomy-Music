"""Read-only settings. Return explicit public fields, never upstream credentials."""
import asyncio
from datetime import date
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

from fastapi import APIRouter, Depends, HTTPException
from .config import settings
from .navidrome import navidrome
from .sessions import identity, destinations
from . import network


def public_url(value):
    try:
        u = urlsplit(value)
        host = u.hostname or ''
        if ':' in host:
            host = '[' + host + ']'
        return urlunsplit((u.scheme, host + (':' + str(u.port) if u.port else ''), u.path, '', ''))
    except ValueError:
        return None


def text(value):
    return value[:200] if isinstance(value, str) and value.strip() else None


def calendar_date(value):
    try:
        return date.fromisoformat(value[:10]).isoformat() if isinstance(value, str) else None
    except ValueError:
        return None


def profile(data):
    if not isinstance(data, dict):
        raise ValueError()
    user = data.get('user', data)
    if not isinstance(user, dict) or not user.get('id'):
        raise ValueError()
    sub = user.get('subscription')
    sub = sub if isinstance(sub, dict) else {}
    credential = user.get('credential')
    credential = credential if isinstance(credential, dict) else {}
    return {'verified': True, 'username': text(user.get('login')) or text(user.get('display_name')),
            'plan': text(sub.get('offer')) or text(credential.get('label')),
            'startDate': calendar_date(sub.get('start_date')), 'endDate': calendar_date(sub.get('end_date')),
            'periodicity': text(sub.get('periodicity')),
            'canceled': sub.get('is_canceled') if isinstance(sub.get('is_canceled'), bool) else None}


def router(auth):
    routes = APIRouter(prefix='/settings', dependencies=[Depends(auth)])

    @routes.get('/server')
    async def server():
        user = identity()
        ping = await navidrome.json('ping')
        folders = []
        for key, dest in destinations().items():
            root = Path(dest['root'])
            try:
                mounted = root.is_dir()
            except OSError:
                mounted = False
            folders.append({'id': key, 'label': dest.get('label', key), 'libraryId': str(dest['library_id']),
                            'path': str(root), 'hostPath': text(dest.get('host_path')), 'available': mounted})
        return {'navidromeURL': public_url(settings.navidrome_url),
                'version': text(ping.get('serverVersion')), 'apiVersion': text(ping.get('version')),
                'username': user.username, 'admin': user.admin, 'expires': user.expires, 'folders': folders}

    @routes.get('/qobuz')
    async def qobuz():
        try:
            # Same configured account as catalog/downloads. No login or token mutation.
            return profile(await asyncio.wait_for(network.catalog('user/get', {}), timeout=50))
        except (HTTPException, ValueError, TypeError, TimeoutError):
            return {'verified': False, 'message': 'Account Qobuz non verificabile. Controlla connessione e login di qoget sul server.'}

    return routes
