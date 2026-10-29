import asyncio
import json
import os
import unittest
from unittest.mock import AsyncMock, patch

os.environ.setdefault('NAVIDROME_URL', 'http://navidrome.test')
from app.stream_resolver import StreamResolver
from app.config import settings


class Process:
    def __init__(self):
        self.returncode = None
        self.stdout = asyncio.StreamReader()
        self.stdin = self
        self.requests = []
        self.drain = AsyncMock()
        self.wait = AsyncMock()
        self.auto = True

    def write(self, data):
        self.requests.append(json.loads(data))
        if self.auto:
            self.stdout.feed_data(b'{"url":"https://cdn.test/audio","full":true}\n')

    def kill(self):
        self.returncode = -9
        self.stdout.feed_eof()


class ResolverTests(unittest.IsolatedAsyncioTestCase):
    async def test_reuse_hot_worker_and_close(self):
        pool = StreamResolver()
        process = Process()
        with patch('app.stream_resolver.asyncio.create_subprocess_exec', AsyncMock(return_value=process)) as spawn:
            for track in ['1', '2', '3', '4']:
                self.assertTrue((await pool.resolve(track))['full'])
            self.assertEqual(spawn.await_count, 1, 'reuse the warm worker before starting idle slots')
            self.assertEqual(spawn.call_args.args, ('metronomy-appid', 'stream-serve'))
            self.assertEqual(process.requests, [{'track_id': str(i)} for i in range(1, 5)])
            await pool.close()
            self.assertEqual(process.returncode, -9)

    async def test_cancel_discards_old_response_and_restarts(self):
        pool = StreamResolver(size=1)
        first, second = Process(), Process()
        first.auto = False
        with patch('app.stream_resolver.asyncio.create_subprocess_exec', AsyncMock(side_effect=[first, second])):
            task = asyncio.create_task(pool.resolve('1'))
            while not first.requests:
                await asyncio.sleep(0)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
            self.assertEqual(first.returncode, -9)
            self.assertTrue((await pool.resolve('2'))['full'])
            self.assertEqual(second.requests, [{'track_id': '2'}])
        await pool.close()

    async def test_malformed_reply_is_not_reused(self):
        pool = StreamResolver(size=1)
        first, second = Process(), Process()
        first.auto = False
        first.stdout.feed_data(b'private invalid adapter response\n')
        with patch('app.stream_resolver.asyncio.create_subprocess_exec', AsyncMock(side_effect=[first, second])):
            with self.assertRaises(ValueError):
                await pool.resolve('1')
            self.assertEqual(first.returncode, -9)
            self.assertTrue((await pool.resolve('2'))['full'])
        await pool.close()

    async def test_timeout_includes_queue_and_concurrency_is_bounded(self):
        pool = StreamResolver(size=1, timeout=.03)
        process = Process()
        process.auto = False
        with patch('app.stream_resolver.asyncio.create_subprocess_exec', AsyncMock(return_value=process)) as spawn:
            results = await asyncio.gather(pool.resolve('1'), pool.resolve('2'), return_exceptions=True)
            self.assertTrue(all(isinstance(r, TimeoutError) for r in results))
            self.assertEqual(spawn.await_count, 1)
            self.assertEqual(process.returncode, -9)
            self.assertEqual(pool.available.qsize(), 1)
        await pool.close()

    async def test_config_path_change_restarts_process(self):
        pool = StreamResolver(size=1)
        first, second = Process(), Process()
        with patch('app.stream_resolver.asyncio.create_subprocess_exec', AsyncMock(side_effect=[first, second])):
            await pool.resolve('1')
            with patch.object(settings, 'qoget_config', '/new/config.json'):
                await pool.resolve('2')
            self.assertEqual(first.returncode, -9)
        await pool.close()

    async def test_process_exit_restarts(self):
        pool = StreamResolver(size=1)
        first, second = Process(), Process()
        with patch('app.stream_resolver.asyncio.create_subprocess_exec', AsyncMock(side_effect=[first, second])):
            await pool.resolve('1')
            first.returncode = 1
            await pool.resolve('2')
            self.assertEqual(second.requests, [{'track_id': '2'}])
        await pool.close()
