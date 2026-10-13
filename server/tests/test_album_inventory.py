"""Album completeness and downloads use exact recordings, not album row counts."""
import asyncio
import os
import sys
import tempfile
import time
import unittest
from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

os.environ['NAVIDROME_URL'] = 'http://navidrome.test'
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
import httpx
from fastapi import FastAPI, HTTPException
from app import network
from app.album_inventory import full_album, inventory

ONE = {'id': 1, 'title': 'First', 'isrc': 'US1234567890', 'duration': 200, 'streamable': True}
TWO = {'id': 2, 'title': 'Second', 'isrc': 'US1234567891', 'duration': 230, 'streamable': True}
ALBUM = {'id': 'abc', 'title': 'Album', 'artist': {'name': 'Artist'}, 'tracks_count': 2,
         'streamable': True, 'tracks': {'items': [ONE, TWO], 'total': 2}}
LOCAL_ONE = {'id': 'one', 'title': 'First', 'artist': 'Artist', 'isrc': ONE['isrc'], 'duration': 200}
LOCAL_TWO = {'id': 'two', 'title': 'Second', 'artist': 'Artist', 'isrc': TWO['isrc'], 'duration': 230}


class InventoryTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        network._album_cache.clear()

    def test_membership_not_counts(self):
        for local in ([LOCAL_ONE], [LOCAL_ONE, {**LOCAL_ONE, 'id': 'copy'}],
                      [LOCAL_ONE, {**LOCAL_TWO, 'isrc': 'OTHERRECORDING'}]):
            state = inventory(ALBUM, local)
            self.assertEqual((state['libraryPresentCount'], state['libraryTotalCount']), (1, 2))
            self.assertFalse(state['libraryComplete'])
            self.assertEqual([t['id'] for t in state['missing']], [2])
        self.assertTrue(inventory(ALBUM, [LOCAL_ONE, LOCAL_TWO])['libraryComplete'])
        self.assertEqual(inventory(ALBUM, [])['libraryPresentCount'], 0)

    def test_fallback_checks_duration_and_version(self):
        plain = {**ALBUM, 'tracks': {'total': 1, 'items': [{k: v for k, v in ONE.items() if k != 'isrc'}]}}
        self.assertTrue(inventory(plain, [LOCAL_ONE])['libraryComplete'])
        self.assertFalse(inventory(plain, [{**LOCAL_ONE, 'duration': 250}])['libraryComplete'])
        self.assertFalse(inventory(plain, [{**LOCAL_ONE, 'title': 'First (Live)'}])['libraryComplete'])

    async def test_pages_are_complete_unique_and_same_album(self):
        raw = {**ALBUM, 'tracks': {'total': 2, 'items': [ONE]}}
        fetch = AsyncMock(side_effect=[raw, {**ALBUM, 'tracks': {'total': 2, 'offset': 1, 'items': [TWO]}}])
        full = await full_album(raw, fetch)
        self.assertEqual([t['id'] for t in full['tracks']['items']], [1, 2])
        self.assertEqual([c.args[1]['offset'] for c in fetch.await_args_list], [0, 1])
        for bad in ({**ALBUM, 'tracks': {'total': 2, 'items': []}},
                    {**ALBUM, 'tracks': {'total': 2, 'items': [ONE]}},
                    {**ALBUM, 'id': 'wrong', 'tracks': {'total': 2, 'items': [TWO]}}):
            with self.assertRaises(HTTPException):
                await full_album(raw, AsyncMock(side_effect=[raw, bad]))
        with self.assertRaises(HTTPException):
            await full_album({**ALBUM, 'tracks': {'total': 2, 'items': [ONE, ONE]}}, AsyncMock())

    async def test_unknown_inventory_never_claims_zero_or_complete(self):
        with patch.object(network, 'catalog', AsyncMock(side_effect=HTTPException(502, 'Unavailable'))), patch.object(network.library, 'read', AsyncMock(return_value=[LOCAL_ONE])):
            items, checked = await network.checked_items([{**ALBUM, 'tracks': {}}], 'album')
        self.assertFalse(checked)
        self.assertFalse(items[0]['libraryComplete'])
        self.assertNotIn('libraryPresentCount', items[0])

    async def test_only_metadata_is_cached_between_library_reads(self):
        with patch.object(network.library, 'read', AsyncMock(return_value=[LOCAL_ONE])):
            partial, _ = await network.checked_items([ALBUM], 'album')
        with patch.object(network.library, 'read', AsyncMock(return_value=[LOCAL_ONE, LOCAL_TWO])):
            complete, _ = await network.checked_items([ALBUM], 'album')
        self.assertEqual(partial[0]['libraryPresentCount'], 1)
        self.assertEqual(complete[0]['libraryPresentCount'], 2)

    async def test_target_plan_is_missing_tracks_only_and_fails_closed(self):
        with patch.object(network.library, 'read', AsyncMock(return_value=[LOCAL_ONE])) as read:
            self.assertEqual(await network.download_targets(ALBUM, 'album'), ['track:2'])
            read.assert_awaited_once_with(fresh=True)
        with patch.object(network.library, 'read', AsyncMock(return_value=[LOCAL_ONE, LOCAL_TWO])):
            self.assertEqual(await network.download_targets(ALBUM, 'album'), [])
        with patch.object(network.library, 'read', AsyncMock(side_effect=HTTPException(403, 'Denied'))):
            with self.assertRaises(HTTPException):
                await network.download_targets(ALBUM, 'album')
        unavailable = {**ALBUM, 'tracks': {'total': 2, 'items': [ONE, {**TWO, 'streamable': False}]}}
        with patch.object(network.library, 'read', AsyncMock(return_value=[LOCAL_ONE])):
            with self.assertRaises(HTTPException):
                await network.download_targets(unavailable, 'album')


class QueueTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.stack = ExitStack()
        self.tmp = self.stack.enter_context(tempfile.TemporaryDirectory())
        self.stack.enter_context(patch.multiple(network.settings, multi_user=False, app_api_key='test',
            network_db=str(Path(self.tmp) / 'jobs.sqlite3'), qoget_directory=self.tmp))
        self.stack.enter_context(patch.object(network, 'credentials', return_value={}))
        self.stack.enter_context(patch.object(network.shutil, 'which', return_value='qoget'))
        self.stack.enter_context(patch.object(network, 'catalog', AsyncMock(return_value=ALBUM)))
        self.read = self.stack.enter_context(patch.object(network.library, 'read', AsyncMock(return_value=[LOCAL_ONE])))
        self.stack.enter_context(patch.object(network.navidrome, 'json', AsyncMock(return_value={})))
        app = FastAPI()
        app.include_router(network.router(lambda: None))
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://bridge.test')

    async def asyncTearDown(self):
        await self.client.aclose()
        self.stack.close()

    async def enqueue(self):
        return await self.client.post('/network/downloads', json={'kind': 'album', 'id': 'abc'})

    async def run_worker_once(self, code=0):
        process = SimpleNamespace(returncode=code, wait=AsyncMock(return_value=code))
        with patch.object(network.asyncio, 'create_subprocess_exec', AsyncMock(return_value=process)) as spawn, patch.object(network.asyncio, 'sleep', AsyncMock(side_effect=asyncio.CancelledError)):
            with self.assertRaises(asyncio.CancelledError):
                await network.worker()
        return spawn

    async def test_partial_album_enqueues_and_invokes_only_missing_recording(self):
        response = await self.enqueue()
        self.assertEqual(response.status_code, 202)
        # Repeated taps reuse the same queued job.
        self.assertEqual((await self.enqueue()).json()['id'], response.json()['id'])
        spawn = await self.run_worker_once()
        self.assertEqual(spawn.await_count, 1)
        self.assertEqual(spawn.call_args.args, ('qoget', 'dl', '-d', self.tmp, '-no-db', 'track:2'))
        self.assertEqual(network.jobs()[0]['status'], 'completed')
        # Navidrome may not have scanned yet: a short per-destination receipt
        # protects the immediate retry, but does not claim library completeness.
        self.assertEqual((await self.enqueue()).status_code, 202)
        (await self.run_worker_once()).assert_not_called()

    async def test_complete_album_refused_and_worker_rechecks_queued_album(self):
        self.assertEqual((await self.enqueue()).status_code, 202)
        self.read.return_value = [LOCAL_ONE, LOCAL_TWO]
        self.assertEqual((await self.enqueue()).status_code, 409)
        (await self.run_worker_once()).assert_not_called()

    async def test_old_completed_album_does_not_block_missing_tracks(self):
        with network.database() as db:
            db.execute("INSERT INTO jobs VALUES ('old','album:abc','Album','completed','',?,'','','')", (time.time() - 500,))
        self.assertEqual((await self.enqueue()).status_code, 202)
        spawn = await self.run_worker_once()
        self.assertEqual(spawn.call_args.args[-1], 'track:2')

    async def test_partial_failure_retry_preserves_successful_missing_tracks(self):
        third = {**TWO, 'id': 3, 'title': 'Third', 'isrc': 'US1234567892'}
        network.catalog.return_value = {**ALBUM, 'tracks_count': 3, 'tracks': {'total': 3, 'items': [ONE, TWO, third]}}
        self.assertEqual((await self.enqueue()).status_code, 202)
        processes = [SimpleNamespace(returncode=code, wait=AsyncMock(return_value=code)) for code in (0, 1)]
        with patch.object(network.asyncio, 'create_subprocess_exec', AsyncMock(side_effect=processes)) as spawn, patch.object(network.asyncio, 'sleep', AsyncMock(side_effect=asyncio.CancelledError)):
            with self.assertRaises(asyncio.CancelledError):
                await network.worker()
            self.assertEqual([call.args[-1] for call in spawn.await_args_list], ['track:2', 'track:3'])
        self.assertEqual(network.jobs()[0]['status'], 'failed')
        self.assertEqual((await self.enqueue()).status_code, 202)
        spawn = await self.run_worker_once()
        self.assertEqual([call.args[-1] for call in spawn.await_args_list], ['track:3'])

    async def test_other_destination_receipt_does_not_suppress_download(self):
        with network.database() as db:
            db.execute('INSERT INTO recent_downloads VALUES (?,?,?,?)', ('track:2', 'lorenza', 'lorenza', time.time()))
        self.assertEqual((await self.enqueue()).status_code, 202)
        spawn = await self.run_worker_once()
        self.assertEqual(spawn.call_args.args[-1], 'track:2')

    async def test_failed_download_does_not_record_success_or_start_scan(self):
        self.assertEqual((await self.enqueue()).status_code, 202)
        await self.run_worker_once(code=1)
        self.assertEqual(network.jobs()[0]['status'], 'failed')
        with network.database() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM recent_downloads').fetchone()[0], 0)
        network.navidrome.json.assert_not_called()


if __name__ == '__main__':
    unittest.main()
