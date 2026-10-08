"""Read real packaged metadata, not guessed version/size/permissions. No signing."""
import hashlib
import json
import plistlib
import re
import sys
import zipfile
from pathlib import Path


def inspect(ipa, native_directory):
    ipa = Path(ipa)
    with zipfile.ZipFile(ipa) as archive:
        names = archive.namelist()
        roots = [n for n in names if re.fullmatch(r'Payload/[^/]+\.app/Info\.plist', n)]
        if len(roots) != 1 or any('.appex/' in n for n in names):
            raise ValueError('Expected one app without extensions; review permission extraction for extensions.')
        info = plistlib.loads(archive.read(roots[0]))
    entitlements = set()
    # Expo writes the main target's entitlements here; Pods are deliberately excluded.
    files = list(Path(native_directory).glob('*/*.entitlements'))
    if not files:
        raise ValueError('No generated entitlements file found; refusing incomplete source permissions.')
    for path in files:
        with path.open('rb') as handle:
            entitlements.update(plistlib.load(handle))
    entitlements.difference_update({'application-identifier', 'com.apple.developer.team-identifier'})
    return {
        'bundleIdentifier': info['CFBundleIdentifier'], 'name': info.get('CFBundleDisplayName', info['CFBundleName']),
        'version': info['CFBundleShortVersionString'], 'buildVersion': info['CFBundleVersion'],
        'minOSVersion': info['MinimumOSVersion'], 'size': ipa.stat().st_size,
        'sha256': hashlib.sha256(ipa.read_bytes()).hexdigest(),
        'appPermissions': {'entitlements': sorted(entitlements),
                           'privacy': {k: v for k, v in info.items() if 'UsageDescription' in k}},
    }


if __name__ == '__main__':
    result = inspect(sys.argv[1], sys.argv[2])
    Path(sys.argv[3]).write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
