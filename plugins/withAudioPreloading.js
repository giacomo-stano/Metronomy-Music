const fs = require('node:fs/promises');
const path = require('node:path');
const { withDangerousMod } = require('expo/config-plugins');

// Keep the warmed AVAsset, never transfer an AVPlayerItem between two players.
// An item has player-specific state/ownership; detaching and immediately
// inserting it elsewhere can raise an Objective-C exception through JSI.
const oldPlayer = '  func replaceWithPreloadedItem(_ item: AVPlayerItem?) {';
const previousPlayer = `  func replaceWithPreloadedItem(_ item: AVPlayerItem?, source: AudioSource) {
    // Metronomy: a speculative failure must not poison normal playback.
    guard let item, item.status != .failed else {
      replaceCurrentSource(source: source)
      return
    }
    self.source = source`;
const newPlayer = previousPlayer + `
    // Reuse indexed media, but give the active player its own playback item.
    let preparedItem = AVPlayerItem(asset: item.asset, automaticallyLoadedAssetKeys: [.tracks, .duration])
    preparedItem.preferredForwardBufferDuration = item.preferredForwardBufferDuration`;
const oldModule = `          let cachedItem = cachedPlayer.currentItem
          cachedPlayer.replaceCurrentItem(with: nil)
          player.replaceWithPreloadedItem(cachedItem)`;
const previousModule = oldModule.replace('replaceWithPreloadedItem(cachedItem)', 'replaceWithPreloadedItem(cachedItem, source: source)');
const newModule = `          let cachedItem = cachedPlayer.currentItem
          // The item stays owned by cachedPlayer until it is released below.
          // AudioPlayer creates a distinct item from the shared asset.
          player.replaceWithPreloadedItem(cachedItem, source: source)`;

function replaceOnce(input, before, after, name) {
  const text = input.replace(/\r\n/g, '\n');
  if (text.includes(after)) return input;
  const candidates = (Array.isArray(before) ? before : [before]).filter(value => text.includes(value));
  if (candidates.length !== 1 || text.split(candidates[0]).length !== 2) {
    throw new Error('Audio preloading: unsupported expo-audio ' + name + '. Review the patch before building.');
  }
  return text.replace(candidates[0], after);
}
const patchPlayer = input => {
  const text = replaceOnce(input, [oldPlayer, previousPlayer], newPlayer, 'AudioPlayer.swift').replace(/\r\n/g, '\n');
  const start = text.indexOf(newPlayer);
  const end = text.indexOf('\n  func replaceCurrentSource(', start);
  if (start < 0 || end < 0) throw new Error('Audio preloading: unsupported AudioPlayer.swift method boundary.');
  const method = text.slice(start, end);
  const patched = replaceOnce(method, '    replacePlayerItem(with: item)', '    replacePlayerItem(with: preparedItem)', 'preloaded item insertion');
  return text.slice(0, start) + patched + text.slice(end);
};
const patchModule = input => replaceOnce(input, [oldModule, previousModule], newModule, 'AudioModule.swift');
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
