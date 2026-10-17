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


class LibrarySearchTests(unittest.IsolatedAsyncioTestCase):
    async def test_pagination_beyond_loaded_library_for_both_types(self):
        for kind, key in [('songs', 'song'), ('albums', 'album')]:
            items = [{'id': str(i), 'title': 'Song', 'name': 'Album'} for i in range(205)]
            async def upstream(method, params):
                self.assertEqual(method, 'search3')
                self.assertEqual(params['query'], 'Neffa & friends')
                self.assertEqual(params['artistCount'], 0)
                self.assertEqual(params[key + 'Count'], 101)
                self.assertEqual(params[('album' if key == 'song' else 'song') + 'Count'], 0)
                start = params[key + 'Offset']
                return {'searchResult3': {key: items[start:start + 101]}}
            with patch.object(main.navidrome, 'json', AsyncMock(side_effect=upstream)):
                pages = []
                cursor = 0
                while True:
                    page = await main.library_search(q=' Neffa & friends ', kind=kind, offset=cursor)
                    pages.extend(page[kind])
                    if not page['hasMore']:
                        break
                    self.assertGreater(page['nextOffset'], cursor)
                    cursor = page['nextOffset']
            self.assertEqual([item['id'] for item in pages], [str(i) for i in range(205)])
            self.assertEqual(page['nextOffset'], 205)

    async def test_deleted_rows_do_not_shorten_or_skip_pages(self):
        items = [{'id': str(i), 'missing': i < 105, 'path': '/private/file'} for i in range(210)]
        async def upstream(method, params):
            start = params['songOffset']
            return {'searchResult3': {'song': items[start:start + 101]}}
        with patch.object(main.navidrome, 'json', AsyncMock(side_effect=upstream)):
            first = await main.library_search(q='Song', kind='songs', offset=0)
            last = await main.library_search(q='Song', kind='songs', offset=first['nextOffset'])
        self.assertEqual(len(first['songs']), 100)
        self.assertEqual(first['nextOffset'], 205)
        self.assertTrue(first['hasMore'])
        self.assertEqual([s['id'] for s in last['songs']], [str(i) for i in range(205, 210)])
        self.assertFalse(last['hasMore'])
        self.assertNotIn('path', first['songs'][0])

    async def test_empty_and_exact_page_end(self):
        for count in (0, 100):
            items = [{'id': str(i)} for i in range(count)]
            with patch.object(main.navidrome, 'json', AsyncMock(return_value={'searchResult3': {'song': items}})):
                page = await main.library_search(q='Song', kind='songs', offset=0)
            self.assertEqual(len(page['songs']), count)
            self.assertFalse(page['hasMore'])

    async def test_invalid_upstream_and_no_fallback(self):
        for result in (None, {'searchResult3': []}, {'searchResult3': {'song': [None]}},
                       {'searchResult3': {'song': [{'title': 'No ID'}]}}):
            with patch.object(main.navidrome, 'json', AsyncMock(return_value=result)):
                with self.assertRaises(HTTPException) as error:
                    await main.library_search(q='Song', kind='songs', offset=0)
                self.assertEqual(error.exception.status_code, 502)
        for status in (401, 403, 502):
            with patch.object(main.navidrome, 'json', AsyncMock(side_effect=HTTPException(status))) as call:
                with self.assertRaises(HTTPException) as error:
                    await main.library_search(q='Song', kind='songs', offset=0)
                self.assertEqual(error.exception.status_code, status)
                self.assertEqual(call.await_count, 1)

    async def test_http_validation_and_authentication(self):
        async def authenticated():
            return None
        async def denied():
            raise HTTPException(401, 'Session required')
        try:
            main.app.dependency_overrides[main.require_api_key] = authenticated
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url='http://bridge.test') as client:
                for params in ({}, {'q': ''}, {'q': '  '}, {'q': 'x' * 201},
                               {'q': 'x', 'offset': -1}, {'q': 'x', 'kind': 'artists'}):
                    response = await client.get('/library/search', params=params)
                    self.assertEqual(response.status_code, 422)
                main.app.dependency_overrides[main.require_api_key] = denied
                with patch.object(main.navidrome, 'json', AsyncMock()) as upstream:
                    response = await client.get('/library/search', params={'q': 'Song'})
                self.assertEqual(response.status_code, 401)
                upstream.assert_not_called()
        finally:
            main.app.dependency_overrides.pop(main.require_api_key, None)


if __name__ == '__main__':
    unittest.main()
