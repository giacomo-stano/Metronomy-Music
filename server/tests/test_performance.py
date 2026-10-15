import asyncio
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

os.environ['NAVIDROME_URL'] = 'http://navidrome.test'
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
import httpx
from app import library_match, network
from app.library_match import RecordingIndex, same_recording
from app.navidrome import NavidromeClient
from app.main import home, app


class MatchingTests(unittest.TestCase):
    def test_index_preserves_first_match_isrc_fallback_versions_and_duration(self):
        local = [
            {'id': 'fallback', 'artist': 'Artìst', 'title': 'Song', 'duration': 200},
            {'id': 'isrc', 'artist': 'Other', 'title': 'Other', 'duration': 300, 'isrc': ['US123', 'GB234']},
            {'id': 'conflict', 'artist': 'Artist', 'title': 'Song', 'duration': 200, 'isrc': 'OTHER'},
            {'id': 'live', 'artist': 'Artist', 'title': 'Song (Live)', 'duration': 201},
        ]
        index = RecordingIndex(local)
        for title in ('Song', 'Other', '', 'Missing'):
            for code in (None, 'US123', 'GB234', 'NO'):
                for duration in (None, 200, 204):
                    for version in (None, 'Live'):
                        remote = {'title': title, 'isrc': code, 'duration': duration, 'version': version, 'performer': {'name': 'Artist'}}
                        expected = next((song for song in local if same_recording(remote, song)), None)
                        self.assertIs(index.match(remote), expected)

    def test_large_library_checks_only_relevant_candidates(self):
        local = [{'id': str(n), 'title': 'Song ' + str(n), 'artist': 'Artist', 'duration': 200} for n in range(10000)]
        index = RecordingIndex(local)
        with patch.object(library_match, 'same_recording', wraps=same_recording) as compare:
            for n in range(9900, 10000):
                self.assertEqual(index.match({'title': 'Song ' + str(n), 'performer': {'name': 'Artist'}, 'duration': 200})['id'], str(n))
            self.assertEqual(compare.call_count, 100, '100 lookups must not scan a million library entries')


class TransportTests(unittest.IsolatedAsyncioTestCase):
    async def test_catalog_reuses_client_but_keeps_tokens_request_scoped(self):
        requests = []
        async def upstream(request):
            requests.append(request)
            return httpx.Response(200, json={'id': 'example'})
        client = httpx.AsyncClient(transport=httpx.MockTransport(upstream))
        with patch.object(network, '_catalog_client', client), patch.object(network, 'credentials', side_effect=[{'auth_token': 'first', 'app_id': '1'}, {'auth_token': 'second', 'app_id': '1'}]):
            self.assertIs(network.catalog_client(), client)
            await network.catalog('track/get', {'track_id': '1'})
            await network.catalog('track/get', {'track_id': '2'})
            self.assertEqual([r.headers['X-User-Auth-Token'] for r in requests], ['first', 'second'])
            self.assertNotIn('X-User-Auth-Token', client.headers)
            await network.close_catalog_client()
            self.assertTrue(client.is_closed)
            self.assertIsNone(network._catalog_client)

    async def test_media_pools_are_separate_and_preserve_range(self):
        nav = NavidromeClient()
        try:
            self.assertIsNot(nav._audio_client, nav._artwork_client)
            self.assertIsNot(nav._client, nav._audio_client)
            response = httpx.Response(206, content=b'audio')
            with patch.object(nav, '_params', side_effect=lambda extra: extra), patch.object(nav._audio_client, 'send', AsyncMock(return_value=response)) as audio, patch.object(nav._artwork_client, 'send', AsyncMock(return_value=httpx.Response(200, content=b'image'))) as image:
                self.assertIs(await nav.stream('song', 'bytes=100-'), response)
                self.assertEqual(audio.call_args.args[0].headers['range'], 'bytes=100-')
                self.assertTrue(audio.call_args.kwargs['stream'])
                await nav.cover('cover')
                self.assertEqual(image.call_args.args[0].url.params['size'], '1024')
                self.assertEqual(image.call_args.args[0].url.params['id'], 'cover')
        finally:
            await nav.close()

    async def test_home_requests_start_together(self):
        entered = []
        both = asyncio.Event()
        async def upstream(endpoint, params):
            entered.append(endpoint)
            if len(entered) == 2:
                both.set()
            await asyncio.wait_for(both.wait(), 1)
            return {}
        with patch('app.main.navidrome.json', AsyncMock(side_effect=upstream)):
            result = await home()
        self.assertEqual(len(entered), 2)
        self.assertEqual(result, {'recentAlbums': [], 'madeForYou': []})

    async def test_embedded_song_is_whitelisted_and_account_scoped(self):
        remote = {'id': 1, 'title': 'Song', 'performer': {'name': 'Artist'}, 'duration': 200}
        local = {'id': 'local', 'title': 'Song', 'artist': 'Artist', 'duration': 200, 'path': '/private/music', 'token': 'secret', 'starred': 'date'}
        with patch.object(network.library, 'read', AsyncMock(return_value=[local])):
            items, _ = await network.checked_items([remote], 'track')
            self.assertEqual(items[0]['librarySong'], {'id': 'local', 'title': 'Song', 'artist': 'Artist', 'duration': 200, 'starred': True})
        with patch.object(network.library, 'read', AsyncMock(return_value=[])):
            items, _ = await network.checked_items([remote], 'track')
            self.assertNotIn('librarySong', items[0])

    async def test_timing_header_contains_only_duration(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://bridge.test') as client:
            result = await client.get('/health')
        self.assertRegex(result.headers['Server-Timing'], r'^bridge;dur=\d+\.\d$')
        self.assertEqual(result.headers['Cache-Control'], 'no-store')
        self.assertIn(result.status_code, (401, 403))


if __name__ == '__main__':
    unittest.main()
