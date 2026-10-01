"""Run without server credentials/network: python -m unittest discover -s server/tests."""
import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.song_metadata import isrc_candidates, normalize_isrc, song, song_info


class ISRCMetadataTests(unittest.TestCase):
    def test_normalizes_one_real_code(self):
        self.assertEqual(normalize_isrc(" us-abc-12-34567 "), "USABC1234567")
        self.assertEqual(normalize_isrc("GB A1B 23 45678"), "GBA1B2345678")

    def test_retains_all_open_subsonic_codes(self):
        self.assertEqual(isrc_candidates({"isrc": ["USABC1234567", "GBA1B2345678"]}),
                         ["USABC1234567", "GBA1B2345678"])

    def test_accepts_known_aliases_and_deduplicates_stably(self):
        self.assertEqual(isrc_candidates({
            "isrc": ["invalid", "us-abc-12-34567", "USABC1234567"],
            "ISRC": "GBA1B2345678", "Isrcs": ["USABC1234567", "DEA1B2456789"],
        }), ["USABC1234567", "GBA1B2345678", "DEA1B2456789"])

    def test_no_guessing_or_substring_extraction(self):
        for value in (None, True, 123456789012, {}, ["USABC1234567"],
                      "ISRC:USABC1234567", "https://example.org/USABC1234567",
                      "USABC1234567;GBA1B2345678", "USABC1234567extra",
                      "USABC１２３４５６７", "uſabc1234567", "USAB1234567", "1SABC1234567"):
            with self.subTest(value=value):
                self.assertIsNone(normalize_isrc(value))
        self.assertEqual(isrc_candidates({
            "title": "USABC1234567", "albumISRC": "USABC1234567",
            "musicBrainzId": "USABC1234567", "info": {"isrc": "USABC1234567"},
            "isrc": [None, {}, ["USABC1234567"]],
        }), [])

    def test_song_and_offline_mapping_preserve_all_codes(self):
        item = {"id": "song-1", "title": "Test", "isrc": ["USABC1234567", "GBA1B2345678"],
                "starred": "2026-09-30", "path": "/private/music.flac", "token": "private"}
        original = copy.deepcopy(item)
        mapped = song(item)
        self.assertEqual(mapped["isrc"], "USABC1234567")
        self.assertEqual(mapped["isrcs"], ["USABC1234567", "GBA1B2345678"])
        self.assertTrue(mapped["starred"])
        self.assertNotIn("path", mapped)
        self.assertNotIn("token", mapped)
        self.assertEqual(item, original)
        # Mapping an already normalized offline song must not lose alternates.
        self.assertEqual(song(mapped)["isrcs"], mapped["isrcs"])

    def test_detail_keeps_legacy_shape_and_adds_candidates(self):
        for value in ("us-abc-12-34567", ["USABC1234567", "GBA1B2345678"]):
            with self.subTest(value=value):
                item = {"id": "song-1", "isrc": value, "suffix": "flac", "path": "private"}
                info = song_info(item)
                self.assertEqual(info["isrc"], value)
                self.assertEqual(info["isrcs"], isrc_candidates(item))
                self.assertEqual(info["suffix"], "flac")
                self.assertNotIn("path", info)

    def test_missing_or_invalid_metadata_never_fabricates_codes(self):
        for value in (None, "", [], "not-an-isrc"):
            with self.subTest(value=value):
                item = {"id": "song-1", "isrc": value}
                self.assertIsNone(song(item)["isrc"])
                self.assertEqual(song(item)["isrcs"], [])
                self.assertEqual(song_info(item)["isrcs"], [])


if __name__ == "__main__":
    unittest.main()
