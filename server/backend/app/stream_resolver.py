"""Bounded, reusable qoget workers. Signed URLs only live in the response."""
import asyncio
import json
import os
from contextlib import suppress

from .config import settings


class StreamWorker:
    def __init__(self):
        self.process = None
        self.config_path = None

    async def close(self):
        process, self.process = self.process, None
        if process is not None:
            if process.returncode is None:
                with suppress(ProcessLookupError):
                    process.kill()
            await process.wait()

    async def resolve(self, track_id):
        try:
            if self.config_path != settings.qoget_config:
                await self.close()
            if self.process is None or self.process.returncode is not None:
                await self.close()
                self.process = await asyncio.create_subprocess_exec(
                    'metronomy-appid', 'stream-serve',
                    env={**os.environ, 'QOGET_CONFIG': settings.qoget_config},
                    stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.DEVNULL, limit=65536)
                self.config_path = settings.qoget_config
            process = self.process
            process.stdin.write(json.dumps({'track_id': track_id}).encode() + b'\n')
            await process.stdin.drain()
            line = await process.stdout.readline()
            data = json.loads(line)
            if not isinstance(data, dict):
                raise ValueError('Invalid adapter response')
            return data
        except BaseException:
            # Never let a cancelled request leave a response for the next caller.
            await self.close()
            raise


class StreamResolver:
    def __init__(self, size=3, timeout=30):
        self.workers = [StreamWorker() for _ in range(size)]
        self.available = asyncio.LifoQueue()
        for worker in self.workers:
            self.available.put_nowait(worker)
        self.timeout = timeout

    async def resolve(self, track_id):
        # Includes queue wait: a busy pool must not extend the request indefinitely.
        async with asyncio.timeout(self.timeout):
            worker = await self.available.get()
            try:
                return await worker.resolve(track_id)
            finally:
                self.available.put_nowait(worker)

    async def close(self):
        await asyncio.gather(*(worker.close() for worker in self.workers))


stream_resolver = StreamResolver()
