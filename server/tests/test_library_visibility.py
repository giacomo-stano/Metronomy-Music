import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

os.environ['NAVIDROME_URL'] = 'http://navidrome.test'
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from app import library_visibility as visibility
from app import main


class VisibilityTests(unittest.IsolatedAsyncioTestCase):
    async def test_deleted_before_scan_and_restored_without_tombstones(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'kept.flac').write_bytes(b'audio fixture')
            rows = [{'id': 'gone', 'path': 'removed.flac', 'libraryId': 1, 'missing': False},
                    {'id': 'kept', 'path': 'kept.flac', 'libraryId': 1, 'missing': False}]
            with patch.object(visibility.settings, 'multi_user', True), patch.object(visibility, 'destinations', return_value={'mine': {'library_id': 1, 'root': folder}}):
                self.assertEqual([i['id'] for i in await visibility.available_songs(rows)], ['kept'])
                (root / 'removed.flac').write_bytes(b'restored fixture')
                self.assertEqual(len(await visibility.available_songs(rows)), 2)

    async def test_unknown_mount_path_or_library_never_proves_deletion(self):
        with tempfile.TemporaryDirectory() as folder:
            rows = [{'id': 'a', 'path': '../outside.flac', 'libraryId': 1},
                    {'id': 'b', 'path': '/outside.flac', 'libraryId': 1},
                    {'id': 'c', 'path': 'other-user.flac', 'libraryId': 2},
                    {'id': 'd', 'path': 'missing.flac'}, {'id': 'e'}]
            with patch.object(visibility.settings, 'multi_user', True), patch.object(visibility, 'destinations', return_value={'mine': {'library_id': 1, 'root': folder}}):
                self.assertEqual(visibility.visible_mask(rows), [True] * 5)
            with patch.object(visibility.settings, 'multi_user', False), patch.object(visibility.settings, 'music_library_directory', str(Path(folder) / 'unmounted')):
                self.assertEqual(visibility.visible_mask([{'id': 'f', 'path': 'file.flac'}]), [True])

    async def test_legacy_prefix_and_missing_values(self):
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder) / 'kept.flac').write_bytes(b'audio')
            with patch.object(visibility.settings, 'multi_user', False), patch.object(visibility.settings, 'music_library_directory', folder), patch.object(visibility.settings, 'navidrome_path_prefix', 'Music'):
                rows = [{'id': 'a', 'path': 'Music/kept.flac'}, {'id': 'b', 'path': 'Music/gone.flac'},
                        {'id': 'c', 'path': 'Other/gone.flac'}]
                self.assertEqual(visibility.visible_mask(rows), [True, False, True])
        self.assertEqual(visibility.visible_mask([{'missing': v} for v in [False, 'false', 0, True, 'true', 1]]), [True, True, True, False, False, False])

    async def test_symlinks_and_io_errors_are_not_followed_or_hidden(self):
        with tempfile.TemporaryDirectory() as folder:
            with patch.object(visibility.settings, 'multi_user', False), patch.object(visibility.settings, 'music_library_directory', folder), patch.object(visibility.settings, 'navidrome_path_prefix', ''):
                with patch.object(Path, 'is_symlink', return_value=True):
                    self.assertEqual(visibility.visible_mask([{'path': 'link/song.flac'}]), [True])
                original_stat = Path.stat
                def stat(path, *args, **kwargs):
                    if path.name == 'denied.flac':
                        raise PermissionError('fixture')
                    return original_stat(path, *args, **kwargs)
                with patch.object(Path, 'stat', stat):
                    self.assertEqual(visibility.visible_mask([{'path': 'denied.flac'}]), [True])

    async def test_native_ignores_filter_but_pagination_has_no_holes_or_skips(self):
        # First 140 rows are deleted; after that every third row is deleted.
        # The upstream deliberately ignores missing=false, as a stale catalog may.
        rows = [{'id': str(i), 'missing': i < 140 or i % 3 == 0} for i in range(500)]
        async def upstream(endpoint, params):
            return rows[params['_start']:params['_end']]
        with patch.object(main.settings, 'multi_user', True), patch.object(main.navidrome, 'native', AsyncMock(side_effect=upstream)):
            found, offset = [], 0
            for _ in range(10):
                page = await main.library_songs(offset=offset, sort='newest')
                found.extend(i['id'] for i in page['songs'])
                self.assertGreater(page['nextOffset'], offset)
                if not page['hasMore']:
                    break
                self.assertEqual(len(page['songs']), 100)
                offset = page['nextOffset']
            else:
                self.fail('pagination did not terminate')
        self.assertEqual(found, [i['id'] for i in rows if not i['missing']])

    async def test_native_physically_deleted_album_before_scan(self):
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder) / 'kept.flac').write_bytes(b'audio')
            rows = [{'id': str(i), 'libraryId': 1, 'path': f'album/{i}.flac', 'missing': False} for i in range(14)]
            rows.append({'id': 'kept', 'libraryId': 1, 'path': 'kept.flac', 'missing': False})
            with patch.object(main.settings, 'multi_user', True), patch.object(main.navidrome, 'native', AsyncMock(return_value=rows)), patch.object(visibility, 'destinations', return_value={'mine': {'library_id': 1, 'root': folder}}):
                result = await main.library_songs(offset=0, sort='newest')
                self.assertEqual([i['id'] for i in result['songs']], ['kept'])
                self.assertEqual(result['nextOffset'], 15)
                self.assertFalse(result['hasMore'])


if __name__ == '__main__':
    unittest.main()
