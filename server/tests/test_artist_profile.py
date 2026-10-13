import os
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

os.environ['NAVIDROME_URL'] = 'http://navidrome.test'
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
import httpx
from fastapi import FastAPI, HTTPException
from app import network
from app.artist_profile import legacy_item, plain_text
from app.sessions import authenticate

ALBUM = {'id': 'album1', 'title': 'A record', 'artist': {'id': 42, 'name': 'Artist'}, 'tracks_count': 13,
         'release_date_original': '2025-10-01', 'streamable': True, 'popularity': 20, 'image': {'large': 'https://image.test/a'}}
TRACK = {'id': 1, 'title': 'Song', 'performer': {'name': 'Artist'}, 'album': ALBUM, 'duration': 200, 'streamable': True}
MODERN = {'id': 'single1', 'title': 'Single', 'artist': {'id': 42, 'name': {'display': 'Artist'}},
          'dates': {'original': '2026-01-01'}, 'rights': {'streamable': True}, 'tracks_count': 1}


class ArtistProfileTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        network._album_cache.clear()
        app = FastAPI()
        app.include_router(network.router(lambda: None))
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://bridge.test')

    async def asyncTearDown(self):
        await self.client.aclose()

    def responses(self, endpoint, params):
        if endpoint == 'artist/get':
            return {'id': 42, 'name': 'Artist', 'image': {'large': 'https://image.test/large', 'mega': 'https://image.test/hero'},
                    'albums': {'items': [ALBUM], 'total': 41}}
        if endpoint == 'artist/page':
            self.assertEqual(params['extra'], 'topTracks')
            return {'biography': {'content': '<p>About &amp; music</p><script>secret()</script>', 'source': 'Qobuz'},
                    'top_tracks': [TRACK, {'id': 2}, TRACK], 'last_release': MODERN,
                    'releases': [{'type': 'epSingle', 'items': [MODERN]}, {'type': 'album', 'items': [ALBUM]}]}
        if endpoint == 'artist/getSimilarArtists':
            return {'artists': {'items': [{'id': 99, 'name': 'Related'}]}}
        if endpoint == 'track/get':
            return {**TRACK, 'id': int(params['track_id'])}
        if endpoint == 'album/get':
            album = ALBUM if params['album_id'] == 'album1' else {**MODERN, 'artist': ALBUM['artist']}
            count = album['tracks_count']
            return {**album, 'tracks': {'total': count, 'items': [{**TRACK, 'id': i + 1, 'title': 'Song' if i == 0 else 'Song ' + str(i)} for i in range(count)]}}
        raise AssertionError(endpoint)

    async def test_profile_projects_real_data_and_preserves_library_matching(self):
        local = {'id': 'owned', 'title': 'Song', 'artist': 'Artist', 'album': 'A record', 'duration': 200}
        with patch.object(network, 'catalog', AsyncMock(side_effect=self.responses)), patch.object(network.library, 'read', AsyncMock(return_value=[local])):
            response = await self.client.get('/network/artist/42/profile')
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data['artist']['cover'], 'https://image.test/hero')
        self.assertEqual(data['artist']['biography'], 'About & music')
        self.assertEqual([i['id'] for i in data['topTracks']], ['1', '2'])
        self.assertEqual(data['topTracks'][0]['libraryMatch'], 'owned')
        self.assertEqual(data['latestRelease']['releaseDate'], '2026-01-01')
        self.assertTrue(data['latestRelease']['available'])
        self.assertEqual(data['latestRelease']['artist'], 'Artist')
        self.assertEqual(data['releases'][0]['title'], 'Singoli e EP')
        self.assertEqual(data['principalAlbums'][0]['id'], 'album1')
        self.assertEqual(data['similarArtists'][0]['id'], '99')
        self.assertTrue(data['albums']['hasMore'])
        self.assertEqual(data['albums']['nextOffset'], 40)
        self.assertNotIn('auth_token', str(data))

    async def test_optional_failures_keep_discography_without_fabricating_top_tracks(self):
        def upstream(endpoint, params):
            if endpoint == 'artist/get':
                return self.responses(endpoint, params)
            raise HTTPException(502, 'private upstream message')
        with patch.object(network, 'catalog', AsyncMock(side_effect=upstream)), patch.object(network.library, 'read', AsyncMock(return_value=[])):
            data = (await self.client.get('/network/artist/42/profile')).json()
        self.assertEqual(data['topTracks'], [])
        self.assertEqual(data['releases'][0]['items'][0]['id'], 'album1')
        self.assertEqual(data['latestRelease']['id'], 'album1')
        self.assertEqual(len(data['partial']), 2)
        self.assertNotIn('private upstream', str(data))

    async def test_matching_is_per_request_not_shared_between_users(self):
        with patch.object(network, 'catalog', AsyncMock(side_effect=self.responses)), patch.object(network.library, 'read', AsyncMock(return_value=[])):
            data = (await self.client.get('/network/artist/42/profile')).json()
        self.assertIsNone(data['topTracks'][0]['libraryMatch'])
        with patch.object(network, 'catalog', AsyncMock(side_effect=self.responses)), patch.object(network.library, 'read', AsyncMock(side_effect=HTTPException(403, 'Denied'))):
            self.assertEqual((await self.client.get('/network/artist/42/profile')).status_code, 403)

    async def test_profile_auth_and_ids(self):
        with patch.object(network, 'catalog', AsyncMock()) as upstream:
            self.assertEqual((await self.client.get('/network/artist/abc/profile')).status_code, 422)
            upstream.assert_not_called()
        app = FastAPI()
        app.include_router(network.router(authenticate))
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://bridge.test') as client:
            self.assertIn((await client.get('/network/artist/42/profile')).status_code, (401, 403))

    async def test_album_detail_contains_playback_and_display_metadata(self):
        with patch.object(network, 'catalog', AsyncMock(return_value={**ALBUM, 'tracks_count': 1, 'tracks': {'items': [TRACK], 'total': 1}})), patch.object(network.library, 'read', AsyncMock(return_value=[])):
            data = (await self.client.get('/network/album/album1')).json()
        self.assertEqual(data['album']['trackCount'], 1)
        self.assertEqual(data['album']['artistId'], '42')
        self.assertEqual(data['items'][0]['duration'], 200)
        self.assertFalse(data['hasMore'])

    def test_modern_track_and_plain_text(self):
        raw = {'id': 4, 'artist': {'name': {'display': 'Artist'}}, 'album': MODERN, 'rights': {'streamable': False}}
        adapted = legacy_item(raw)
        self.assertEqual(adapted['performer']['name'], 'Artist')
        self.assertFalse(adapted['streamable'])
        self.assertEqual(adapted['album']['artist']['name'], 'Artist')
        self.assertEqual(plain_text(None), '')
        self.assertEqual(plain_text('<p>A</p><p>B<br>C</p>'), 'A\nB\nC')


if __name__ == '__main__':
    unittest.main()
