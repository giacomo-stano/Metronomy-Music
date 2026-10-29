const fs = require('node:fs/promises');
const path = require('node:path');
const { withDangerousMod } = require('expo/config-plugins');

// expo-audio 57's preloaded-item path omits source bookkeeping. Keep the source
// for media-services reset, and retry normally if the speculative item failed.
const oldPlayer = '  func replaceWithPreloadedItem(_ item: AVPlayerItem?) {';
const newPlayer = `  func replaceWithPreloadedItem(_ item: AVPlayerItem?, source: AudioSource) {
    // Metronomy: a speculative failure must not poison normal playback.
    guard let item, item.status != .failed else {
      replaceCurrentSource(source: source)
      return
    }
    self.source = source`;
const oldModule = '          player.replaceWithPreloadedItem(cachedItem)';
const newModule = '          player.replaceWithPreloadedItem(cachedItem, source: source)';

function replaceOnce(input, before, after, name) {
  const text = input.replace(/\r\n/g, '\n');
  if (text.includes(after) && !text.includes(before)) return input;
  if (text.split(before).length !== 2) {
    throw new Error('Audio preloading: unsupported expo-audio ' + name + '. Review the patch before building.');
  }
  return text.replace(before, after);
}
const patchPlayer = input => replaceOnce(input, oldPlayer, newPlayer, 'AudioPlayer.swift');
const patchModule = input => replaceOnce(input, oldModule, newModule, 'AudioModule.swift');
function nativePaths(projectRoot) {
  const root = path.dirname(require.resolve('expo-audio/package.json', { paths: [projectRoot] }));
  return { player: path.join(root, 'ios', 'AudioPlayer.swift'), module: path.join(root, 'ios', 'AudioModule.swift') };
}
module.exports = config => withDangerousMod(config, ['ios', async config => {
  const files = nativePaths(config.modRequest.projectRoot);
  for (const [key, patch] of [['player', patchPlayer], ['module', patchModule]]) {
    const source = await fs.readFile(files[key], 'utf8');
    const patched = patch(source);
    if (patched !== source) await fs.writeFile(files[key], patched);
  }
  return config;
}]);
Object.assign(module.exports, { patchPlayer, patchModule, nativePaths, newPlayer, newModule });
