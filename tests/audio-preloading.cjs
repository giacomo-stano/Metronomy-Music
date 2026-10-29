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
assert(require('../app.json').expo.plugins.includes('./plugins/withAudioPreloading'));
console.log('Native preload: failed-item fallback, media-services source recovery, dependency guards and idempotence passed.');
