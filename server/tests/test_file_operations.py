"""Cancellation must not unlock a deletion while its filesystem thread runs."""
import asyncio
import os
import sys
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

os.environ.setdefault('NAVIDROME_URL', 'http://navidrome.test')
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from app import file_ops


class FileOperationTests(unittest.IsolatedAsyncioTestCase):
    async def test_cancelled_request_keeps_lock_until_filesystem_finishes(self):
        entered, release, finished = threading.Event(), threading.Event(), threading.Event()
        lock = asyncio.Lock()

        def move(*_):
            entered.set()
            if not release.wait(5):
                raise RuntimeError('Test did not release filesystem worker')
            finished.set()
            return 'receipt'

        routes = file_ops.router(lambda: None)
        delete = next(route.endpoint for route in routes.routes if route.path.endswith('/delete'))
        with patch.object(file_ops.settings, 'multi_user', False), \
             patch.object(file_ops.settings, 'app_api_key', 'test'), \
             patch.object(file_ops, 'lock', lock), \
             patch.object(file_ops.Path, 'is_dir', return_value=True), \
             patch.object(file_ops, 'source_path', return_value=Path('test.flac')), \
             patch.object(file_ops, 'confirmation', return_value='valid'), \
             patch.object(file_ops, 'move_to_trash', side_effect=move), \
             patch.object(file_ops.navidrome, 'json', AsyncMock(return_value={'song': {'id': 'one'}})):
            task = asyncio.create_task(delete('one', file_ops.DeleteConfirmation(token='valid', expires=int(time.time()) + 60)))
            try:
                self.assertTrue(await asyncio.to_thread(entered.wait, 3))
                task.cancel()
                await asyncio.sleep(0)
                self.assertFalse(task.done())
                self.assertTrue(lock.locked(), 'trash/album mutations must still wait')
                self.assertFalse(finished.is_set())
            finally:
                release.set()
                with self.assertRaises(asyncio.CancelledError):
                    await task
            self.assertTrue(finished.is_set())
            self.assertFalse(lock.locked())
