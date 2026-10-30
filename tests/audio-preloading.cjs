const assert = require('node:assert/strict');
const fs = require('node:fs');
const { patchPlayer, patchModule, nativePaths, newPlayer, newModule } = require('../plugins/withAudioPreloading');
const paths = nativePaths(process.cwd());
for (const [file, patch, expected] of [[paths.player, patchPlayer, newPlayer], [paths.module, patchModule, newModule]]) {
  const source = fs.readFileSync(file, 'utf8');
  const output = patch(source);
  assert(output.includes(expected));
  assert.equal(patch(output), output, 'prebuild must be idempotent');
  assert.throws(() => patch('unknown dependency version'), /unsupported/);
  if (process.argv.includes('--verify-installed')) assert(source.replace(/\r\n/g, '\n').includes(expected));
}
assert(newPlayer.includes('item.status != .failed') && newPlayer.includes('replaceCurrentSource(source: source)'));
assert(newPlayer.includes('self.source = source'), 'media-services recovery must use the new track');
const patchedPlayer = patchPlayer(fs.readFileSync(paths.player, 'utf8'));
const method = patchedPlayer.slice(patchedPlayer.indexOf(newPlayer), patchedPlayer.indexOf('\n  func replaceCurrentSource('));
assert(method.includes('AVPlayerItem(asset: item.asset'), 'each active player owns a distinct playback item');
assert(method.includes('replacePlayerItem(with: preparedItem)'));
assert(!method.includes('replacePlayerItem(with: item)'), 'do not insert the cached player item into another player');
assert(!newModule.includes('cachedPlayer.replaceCurrentItem'), 'do not transfer/detach a live cached queue item');
// An existing prebuild may still contain the previous version of our patch.
const v1Header = newPlayer.slice(0, newPlayer.indexOf('\n    // Reuse indexed media'));
const v1Player = patchedPlayer.replace(newPlayer, v1Header).replace('replacePlayerItem(with: preparedItem)', 'replacePlayerItem(with: item)');
const v1Transfer = '          let cachedItem = cachedPlayer.currentItem\n          cachedPlayer.replaceCurrentItem(with: nil)\n          player.replaceWithPreloadedItem(cachedItem, source: source)';
const patchedModule = patchModule(fs.readFileSync(paths.module, 'utf8'));
assert.equal(patchPlayer(v1Player), patchedPlayer, 'upgrade the previous native patch in place');
assert.equal(patchModule(patchedModule.replace(newModule, v1Transfer)), patchedModule);
assert(require('../app.json').expo.plugins.includes('./plugins/withAudioPreloading'));
console.log('Native preload: distinct item ownership, failed-asset fallback, source recovery, migration and idempotence passed.');
