import asyncio
import logging
import unittest
from unittest.mock import patch

from app.stream_diagnostics import safe_range, safe_content_range, song_tag, trace_context, traced_bytes, trace_headers


class StreamDiagnosticsTests(unittest.TestCase):
    def test_range_sanitization(self):
        self.assertEqual(safe_range('bytes=0-'), 'bytes=0-')
        self.assertEqual(safe_range('bytes=-2048'), 'bytes=-2048')
        self.assertEqual(safe_range('bytes=100-199'), 'bytes=100-199')
        self.assertEqual(safe_range(None), 'none')
        self.assertEqual(safe_range('bytes=0-1\\nAuthorization: secret'), 'invalid')
        self.assertEqual(safe_range('bytes=0-1,20-30'), 'invalid')

    def test_content_range_sanitization(self):
        self.assertEqual(safe_content_range('bytes 0-99/1000'), 'bytes 0-99/1000')
        self.assertEqual(safe_content_range('bytes */1000'), 'invalid')
        self.assertEqual(safe_content_range('secret'), 'invalid')

    def test_log_has_no_plaintext_ids(self):
        ctx = trace_context('private-song-id', 'bytes=0-')
        self.assertNotIn('private-song-id', str(ctx))
        self.assertEqual(song_tag('private-song-id'), ctx['song'])
        with self.assertLogs('uvicorn.error', logging.WARNING) as logs:
            trace_headers(ctx, 206, {'content-range':'bytes 0-10/100', 'accept-ranges':'bytes'})
        self.assertNotIn('private-song-id', ''.join(logs.output))
        self.assertIn('upstream_headers_ms=', ''.join(logs.output))

    def test_first_byte_and_end(self):
        async def source():
            yield b'ab'
            yield b'cd'
        async def run():
            ctx = trace_context('song-1', 'bytes=0-')
            ctx['status'] = 206
            with self.assertLogs('uvicorn.error', logging.WARNING) as logs:
                body = b''.join([chunk async for chunk in traced_bytes(source(), ctx)])
            self.assertEqual(body, b'abcd')
            self.assertIn('transferred_bytes=4', ''.join(logs.output))
            self.assertIn('completed=True', ''.join(logs.output))
        asyncio.run(run())


if __name__ == '__main__':
    unittest.main()
