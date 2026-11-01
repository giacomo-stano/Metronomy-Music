const fs = require('node:fs/promises');
const path = require('node:path');
const { withDangerousMod } = require('expo/config-plugins');

// expo-audio 57 creates every local/remote AVURLAsset here. Zero seek tolerance
// alone cannot fix a byte-to-time index that AVFoundation estimated at load time.
const original = `    var options: [String: Any]?
    if let headers = source.headers {
      options = ["AVURLAssetHTTPHeaderFieldsKey": headers]
    }`;
const replacement = `    // Metronomy: index the asset precisely before seeking (including FLAC/VBR).
    var options: [String: Any] = [AVURLAssetPreferPreciseDurationAndTimingKey: true]
    if let headers = source.headers {
      options["AVURLAssetHTTPHeaderFieldsKey"] = headers
    }`;

function patchAudioUtils(input) {
  const source = input.replace(/\r\n/g, '\n');
  if (source.includes(replacement) && !source.includes(original)) return input;
  if (source.split(original).length !== 2 || source.includes('AVURLAssetPreferPreciseDurationAndTimingKey')) {
    throw new Error('Precise audio timing: unsupported expo-audio AudioUtils.swift. Review the patch before building.');
  }
  return source.replace(original, replacement);
}

// Precise timing is still required for FLAC/VBR seeks. Loading its duration is
// not a prerequisite for the first sound: the UI uses catalog duration until
// AVPlayer publishes the native duration. Keep the asset's precision option.
function patchStartupKeys(input) {
  const before = 'return AVPlayerItem(asset: asset, automaticallyLoadedAssetKeys: [.tracks, .duration])';
  const after = 'return AVPlayerItem(asset: asset, automaticallyLoadedAssetKeys: [.tracks])';
  if (input.includes(after) && !input.includes(before)) return input;
  if (input.split(before).length !== 2) throw new Error('Audio startup: unsupported AudioUtils.swift factory.');
  return input.replace(before, after);
}

function audioUtilsPath(projectRoot) {
  const packagePath = require.resolve('expo-audio/package.json', { paths: [projectRoot] });
  return path.join(path.dirname(packagePath), 'ios', 'AudioUtils.swift');
}

module.exports = config => withDangerousMod(config, ['ios', async config => {
  const file = audioUtilsPath(config.modRequest.projectRoot);
  const source = await fs.readFile(file, 'utf8');
  const patched = patchStartupKeys(patchAudioUtils(source));
  if (patched !== source) await fs.writeFile(file, patched);
  return config;
}]);
module.exports.patchAudioUtils = patchAudioUtils;
module.exports.audioUtilsPath = audioUtilsPath;
module.exports.replacement = replacement;
module.exports.patchStartupKeys = patchStartupKeys;
