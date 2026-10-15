import os
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

os.environ['NAVIDROME_URL'] = 'http://navidrome.test'
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
import httpx
from fastapi import HTTPException
from app import main
from app.library_match import library
from app.library_order import ordered_songs


class LibraryTests(unittest.IsolatedAsyncioTestCase):
    def tracks(self, count=205):
        return [{'id': str(i), 'title': f'Track {i:03}', 'artist': 'Artist',
                 'created': f'2026-10-15T12:{i // 60:02}:{i % 60:02}Z',
                 'year': 1980 if i == count - 1 else 2026} for i in range(count)]

    async def test_legacy_global_date_sort_before_pagination(self):
        items = self.tracks()
        with patch.object(main.settings, 'multi_user', False), patch.object(library, 'read', AsyncMock(return_value=items)):
            first = await main.library_songs(offset=0, sort='newest')
            second = await main.library_songs(offset=100, sort='newest')
            last = await main.library_songs(offset=200, sort='newest')
            empty = await main.library_songs(offset=300, sort='newest')
        ids = [i['id'] for page in (first, second, last) for i in page['songs']]
        self.assertEqual(ids, [str(i) for i in reversed(range(205))])
        self.assertEqual(first['nextOffset'], 100)
        self.assertTrue(first['hasMore'])
        self.assertFalse(last['hasMore'])
        self.assertFalse(empty['hasMore'])
        self.assertEqual(first['songs'][0]['year'], 1980)
        self.assertEqual(first['songs'][0]['created'], items[-1]['created'])

    async def test_native_global_query_and_safe_metadata(self):
        items = self.tracks()
        native = [{**i, 'createdAt': i['created'], 'albumId': 'album',
                   'trackNumber': 2, 'path': '/private/file', 'starred': True} for i in items]
        for item in native:
            del item['created']
        async def upstream(endpoint, params):
            self.assertEqual(endpoint, 'song')
            self.assertEqual(params['_sort'], 'createdAt')
            self.assertEqual(params['_order'], 'DESC')
            ordered = ordered_songs(native, 'newest')
            return ordered[params['_start']:params['_end']]
        with patch.object(main.settings, 'multi_user', True), patch.object(main.navidrome, 'native', AsyncMock(side_effect=upstream)) as call, patch.object(library, 'read', AsyncMock()) as legacy:
            first = await main.library_songs(offset=0, sort='newest')
            last = await main.library_songs(offset=200, sort='newest')
        legacy.assert_not_called()
        self.assertEqual(call.call_args_list[0].args[1]['_end'], 101)
        self.assertEqual(first['songs'][0]['id'], '204')
        self.assertEqual(last['nextOffset'], 205)
        self.assertFalse(last['hasMore'])
        self.assertNotIn('path', first['songs'][0])
        self.assertEqual(first['songs'][0]['coverArt'], 'album')
        self.assertEqual(first['songs'][0]['track'], 2)
        self.assertTrue(first['songs'][0]['starred'])

    async def test_native_sort_modes_and_no_admin_fallback(self):
        with patch.object(main.settings, 'multi_user', True), patch.object(main.navidrome, 'native', AsyncMock(return_value=[])) as call:
            for sort, field in [('oldest', 'createdAt'), ('title', 'title'), ('artist', 'artist')]:
                await main.library_songs(offset=100, sort=sort)
                self.assertEqual(call.call_args.args[1], {'_start': 100, '_end': 201, '_sort': field, '_order': 'ASC'})
        for code in (401, 403, 502):
            with patch.object(main.settings, 'multi_user', True), patch.object(main.navidrome, 'native', AsyncMock(side_effect=HTTPException(code))), patch.object(library, 'read', AsyncMock()) as fallback:
                with self.assertRaises(HTTPException) as caught:
                    await main.library_songs(offset=0, sort='newest')
                self.assertEqual(caught.exception.status_code, code)
                fallback.assert_not_called()

    async def test_exact_full_page_is_terminal(self):
        with patch.object(main.settings, 'multi_user', True), patch.object(main.navidrome, 'native', AsyncMock(return_value=self.tracks(100))):
            result = await main.library_songs(offset=0, sort='newest')
        self.assertEqual(len(result['songs']), 100)
        self.assertFalse(result['hasMore'])

    async def test_malformed_native_response(self):
        for value in ({}, [None], [{'title': 'No ID'}]):
            with patch.object(main.settings, 'multi_user', True), patch.object(main.navidrome, 'native', AsyncMock(return_value=value)):
                with self.assertRaises(HTTPException):
                    await main.library_songs(offset=0, sort='newest')

    async def test_favorites_use_added_not_starred_date(self):
        items = self.tracks(3)
        items[0]['starred'] = '2099-01-01T00:00:00Z'
        with patch.object(main.navidrome, 'json', AsyncMock(return_value={'starred2': {'song': items}})):
            result = await main.library_favorites(sort='newest')
        self.assertEqual([i['id'] for i in result['songs']], ['2', '1', '0'])
        self.assertTrue(all(i['starred'] for i in result['songs']))

    async def test_invalid_order_is_rejected(self):
        async def authenticated():
            return None
        main.app.dependency_overrides[main.require_api_key] = authenticated
        try:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url='http://bridge.test') as client:
                for query in ('sort=random', 'offset=-1', 'sort=createdAt,token'):
                    response = await client.get('/library/songs?' + query)
                    self.assertEqual(response.status_code, 422)
        finally:
            main.app.dependency_overrides.pop(main.require_api_key, None)

    def test_dates_timezones_unknowns_and_alphabetic_order(self):
        rows = [
            {'id': 'z', 'title': 'Zulu', 'artist': 'A', 'created': '2026-10-15T12:00:00+02:00'},
            {'id': 'a', 'title': 'Alpha', 'artist': 'Z', 'createdAt': '2026-10-15T11:00:00Z'},
            {'id': 'u', 'title': 'Unknown', 'created': 'bad', 'year': 2099},
        ]
        expected = {'newest': ['a', 'z', 'u'], 'oldest': ['z', 'a', 'u'], 'title': ['a', 'u', 'z'], 'artist': ['u', 'z', 'a']}
        for order, ids in expected.items():
            self.assertEqual([i['id'] for i in ordered_songs(rows, order)], ids)
        self.assertEqual(rows[0]['id'], 'z', 'sorting never mutates the shared library index')


if __name__ == '__main__':
    unittest.main()
