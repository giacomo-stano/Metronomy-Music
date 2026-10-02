import asyncio
import json
import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

os.environ['NAVIDROME_URL'] = 'http://navidrome.test'
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
import httpx
from fastapi import FastAPI, HTTPException
from app import network, recommendations
from app.sessions import authenticate

TRACK = {'id': 123, 'title': 'Test', 'duration': 240, 'streamable': True, 'performer': {'name': 'Artist'},
         'album': {'id': 'abc', 'title': 'Album', 'artist': {'name': 'Artist'}, 'genre': {'name': 'Electronic'}, 'image': {'large': 'https://images.test/a.jpg'}}}
LOCAL = {'id': 'local1', 'title': 'Test', 'artist': 'Artist', 'duration': 240, 'album': 'Album', 'genre': 'Elettronica'}


class CatalogTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        app = FastAPI()
        app.include_router(network.router(lambda: None))
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://bridge.test')

    async def asyncTearDown(self):
        await self.client.aclose()

    async def test_unified_search_and_independent_page_offset(self):
        async def catalog(endpoint, params):
            self.assertEqual(params['offset'], 12)
            self.assertEqual(params['limit'], 12)
            kind = endpoint.split('/')[0]
            raw = TRACK if kind == 'track' else TRACK['album'] if kind == 'album' else {'id': 123, 'name': 'Artist'}
            return {kind + 's': {'items': [raw], 'total': 30}}
        with patch.object(network, 'catalog', AsyncMock(side_effect=catalog)) as upstream, patch.object(network.library, 'read', AsyncMock(return_value=[LOCAL])):
            response = await self.client.get('/network/search', params={'q': 'test', 'offset': 12})
        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual({i['kind'] for i in result['items']}, {'track', 'album', 'artist'})
        self.assertEqual(result['items'][0]['libraryMatch'], 'local1')
        self.assertEqual(result['nextOffset'], 24)
        self.assertTrue(result['hasMore'])
        self.assertEqual(upstream.await_count, 3)

    async def test_detail_and_validation(self):
        with patch.object(network, 'catalog', AsyncMock(return_value={'name': 'Artist', 'albums': {'items': [TRACK['album']], 'total': 41}})), patch.object(network.library, 'read', AsyncMock(return_value=[])):
            data = (await self.client.get('/network/artist/123')).json()
            self.assertEqual(data['items'][0]['kind'], 'album')
            self.assertEqual(data['nextOffset'], 40)
            self.assertTrue(data['hasMore'])
        with patch.object(network, 'catalog', AsyncMock(return_value={**TRACK['album'], 'tracks': {'items': [TRACK], 'total': 1}})), patch.object(network.library, 'read', AsyncMock(return_value=[])):
            data = (await self.client.get('/network/album/abc')).json()
            self.assertEqual(data['items'][0]['artist'], 'Artist')
        with patch.object(network, 'catalog', AsyncMock()) as upstream:
            for path in ['/network/artist/abc', '/network/playback/1;rm', '/network/album/a.b']:
                self.assertEqual((await self.client.get(path)).status_code, 422)
            upstream.assert_not_called()

    async def test_complete_playback_restrictions_and_metadata(self):
        with patch.object(network, 'catalog', AsyncMock(return_value={**TRACK, 'streamable': False})), patch.object(network, 'full_stream', AsyncMock()) as stream:
            self.assertEqual((await self.client.get('/network/playback/123')).status_code, 403)
            stream.assert_not_called()
        with patch.object(network, 'catalog', AsyncMock(return_value=TRACK)), patch.object(network, 'full_stream', AsyncMock(return_value={'url': 'https://cdn.test/full'})):
            self.assertEqual((await self.client.get('/network/playback/123')).json(), {'url': 'https://cdn.test/full'})
            song = (await self.client.get('/network/track/123')).json()['song']
            self.assertEqual(song['id'], 'qobuz:123')
            self.assertEqual(song['qobuzId'], '123')
            self.assertNotIn('url', song)

    async def test_stream_adapter_never_accepts_previews_or_leaks_output(self):
        for payload in [{'url': 'https://cdn.test/full', 'full': True}, {'url': 'https://cdn.test/private', 'sample': True}, {'url': 'http://cdn.test/full', 'full': True}, {'url': 'https://user:password@cdn.test/full', 'full': True}]:
            process = SimpleNamespace(returncode=0, communicate=AsyncMock(return_value=(json.dumps(payload).encode(), b'')))
            with patch.object(network, 'credentials', return_value={}), patch.object(network.asyncio, 'create_subprocess_exec', AsyncMock(return_value=process)) as spawn:
                if payload == {'url': 'https://cdn.test/full', 'full': True}:
                    self.assertEqual(await network.full_stream('123'), {'url': payload['url']})
                else:
                    with self.assertRaises(HTTPException) as failure:
                        await network.full_stream('123')
                    self.assertNotIn(payload['url'], failure.exception.detail)
                    self.assertEqual(failure.exception.status_code, 403)
                self.assertEqual(spawn.call_args.args, ('metronomy-appid', 'stream', '123'))

    async def test_library_failures_do_not_bypass_download_checks(self):
        with patch.object(network.library, 'read', AsyncMock(return_value=[LOCAL])):
            self.assertEqual((await network.duplicate(TRACK, 'track'))['id'], 'local1')
        with patch.object(network.library, 'read', AsyncMock(side_effect=HTTPException(503, 'Unavailable'))):
            items, checked = await network.checked_items([TRACK], 'track')
            self.assertFalse(checked)
            self.assertIsNone(items[0]['libraryMatch'])
        with patch.object(network.library, 'read', AsyncMock(side_effect=HTTPException(403, 'Denied'))):
            with self.assertRaises(HTTPException):
                await network.checked_items([TRACK], 'track')
        self.assertEqual((await self.client.post('/network/downloads', json={'kind': 'artist', 'id': '123'})).status_code, 422)

    async def test_authentication_is_required(self):
        app = FastAPI()
        app.include_router(network.router(authenticate))
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://bridge.test') as client:
            for path in ['/network/search?q=x', '/network/playback/123', '/network/artist/123']:
                self.assertIn((await client.get(path)).status_code, (401, 403))
            self.assertIn((await client.post('/network/recommendations', json={'seeds': []})).status_code, (401, 403))

    async def test_recommendations_are_genre_based_and_account_scoped(self):
        calls = []
        async def catalog(endpoint, params):
            calls.append((endpoint, params))
            if endpoint == 'genre/list':
                return {'genres': {'items': [{'id': 1, 'name': 'Electronic'}, {'id': 2, 'name': 'Jazz'}]}}
            if endpoint == 'album/getFeatured':
                return {'albums': {'items': [TRACK['album']]}}
            if endpoint == 'album/get':
                return {**TRACK['album'], 'tracks': {'items': [TRACK]}}
            raise AssertionError(endpoint)
        nav = SimpleNamespace(json=AsyncMock(return_value={'albumList2': {'album': []}}))
        lib = SimpleNamespace(read=AsyncMock(return_value=[LOCAL]))
        seeds = [network.ListenSeed(id='local1', plays=4), network.ListenSeed(id='other-user-track', plays=100)]
        items, genres = await recommendations.recommend(seeds, catalog, nav, lib)
        self.assertEqual(genres, ['Electronic'])
        self.assertEqual(items[0]['id'], 123)
        self.assertEqual(next(p for e, p in calls if e == 'album/getFeatured')['genre_ids'], '1')
        calls.clear()
        lib.read = AsyncMock(return_value=[{**LOCAL, 'genre': 'Jazz'}])
        _, genres = await recommendations.recommend(seeds, catalog, nav, lib)
        self.assertEqual(genres, ['Jazz'])
        calls.clear()
        _, genres = await recommendations.recommend([], catalog, nav, lib)
        self.assertEqual(genres, [])
        self.assertNotIn('genre_ids', next(p for e, p in calls if e == 'album/getFeatured'))


if __name__ == '__main__':
    unittest.main()
