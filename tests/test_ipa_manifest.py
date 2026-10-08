import importlib.util
import plistlib
import tempfile
import unittest
import zipfile
from pathlib import Path

spec = importlib.util.spec_from_file_location('inspect_ipa', Path(__file__).resolve().parents[1] / 'scripts/inspect-ipa.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class IPAManifestTests(unittest.TestCase):
    def test_binary_plist_metadata_and_permissions(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / 'ios' / 'MetronomyBeta'
            target.mkdir(parents=True)
            (target / 'MetronomyBeta.entitlements').write_bytes(plistlib.dumps({'com.apple.security.application-groups': ['group.test']}))
            ipa = root / 'app.ipa'
            with zipfile.ZipFile(ipa, 'w') as archive:
                archive.writestr('Payload/MetronomyBeta.app/Info.plist', plistlib.dumps({
                    'CFBundleIdentifier': 'com.anonymous.metronomy.beta', 'CFBundleName': 'MetronomyBeta',
                    'CFBundleDisplayName': 'Metronomy Beta', 'CFBundleVersion': '100.1',
                    'CFBundleShortVersionString': '0.2.3', 'MinimumOSVersion': '16.4',
                    'NSMicrophoneUsageDescription': 'Audio',
                }, fmt=plistlib.FMT_BINARY))
            result = module.inspect(ipa, root / 'ios')
            self.assertEqual(result['name'], 'Metronomy Beta')
            self.assertEqual(result['size'], ipa.stat().st_size)
            self.assertEqual(len(result['sha256']), 64)
            self.assertEqual(result['appPermissions']['privacy'], {'NSMicrophoneUsageDescription': 'Audio'})
            self.assertEqual(result['appPermissions']['entitlements'], ['com.apple.security.application-groups'])
            with self.assertRaises(ValueError):
                module.inspect(ipa, root / 'missing')
            with zipfile.ZipFile(ipa, 'a') as archive:
                archive.writestr('Payload/MetronomyBeta.app/PlugIns/Example.appex/Info.plist', b'')
            with self.assertRaises(ValueError):
                module.inspect(ipa, root / 'ios')


if __name__ == '__main__':
    unittest.main()
