const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(name, api = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/' + name + '.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, { exports, require: () => api, Date });
  return exports;
}
const tick = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  const { playbackSignals, samePlaybackSignals } = load('playbackSignals');
  let prev, changes = 0;
  for (let frame = 0; frame < 240; frame++) {
    const next = playbackSignals({ playing: true, didJustFinish: false, currentTime: frame / 4 });
    if (!prev || !samePlaybackSignals(prev, next)) changes++;
    prev = next;
  }
  assert.equal(changes, 2, '240 progress events produce only start and history-threshold state changes');
  assert(!samePlaybackSignals(prev, playbackSignals({ playing: false, didJustFinish: true, currentTime: 60 })));
  let account = {}, inflight = 0, peak = 0;
  const calls = [], work = [];
  const api = { currentAccount: () => account, request: path => new Promise(resolve => {
    calls.push(path); peak = Math.max(peak, ++inflight);
    work.push(() => { inflight--; resolve({ songs: [{ id: path }] }); });
  }) };
  const cache = load('albumPrefetch', api);
  const tasks = Array.from({ length: 8 }, (_, i) => cache.preloadAlbumSongs(String(i)));
  assert.equal(calls.length, 3);
  assert.equal(cache.preloadAlbumSongs('7', false, true), tasks[7]);
  work.shift()(); await tick(); assert.equal(calls[3], 'albums/7', 'opened album jumps ahead of queued preloads');
  while (work.length) { work.shift()(); await tick(); }
  await Promise.all(tasks); assert.equal(peak, 3);
  const before = calls.length; await cache.preloadAlbumSongs('1'); assert.equal(calls.length, before);
  for (let i = 10; i < 55; i++) { const p = cache.preloadAlbumSongs(String(i)); work.shift()(); await p; await tick(); }
  assert.equal(cache.peekAlbumSongs('1'), undefined, 'bounded cache evicts oldest entries');
  const stale = cache.preloadAlbumSongs('stale').catch(e => e);
  account = {}; assert.equal(cache.peekAlbumSongs('54'), undefined);
  work.shift()(); await stale; await tick(); assert.equal(cache.peekAlbumSongs('stale'), undefined, 'old session cannot repopulate cache');
  const requests = Array.from({length: 5}, (_, i) => cache.preloadAlbumSongs('clear-' + i).catch(e => e));
  cache.clearAlbumSongsCache(); while (work.length) { work.shift()(); await tick(); }
  await Promise.all(requests); assert.equal(cache.peekAlbumSongs('clear-0'), undefined);
  console.log('Performance: playback signal filtering, bounded/concurrent/priority album prefetch, deduplication and account invalidation passed.');
})().catch(e => { console.error(e); process.exitCode = 1; });
