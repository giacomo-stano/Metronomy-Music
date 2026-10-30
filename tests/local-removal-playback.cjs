const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
// Execute the real callback with a controlled native clock. No UI/gesture mocks.
const source = ts.createSourceFile('PlayerSheet.tsx', fs.readFileSync('src/PlayerSheet.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback;
function find(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'afterRemoveLocal') callback = node.getText(source);
  ts.forEachChild(node, find);
}
find(source); assert(callback);
const compiled = ts.transpileModule(callback + '\nexports.restore = afterRemoveLocal;', {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
function setup() {
  const calls = [], timers = [], activeSong = { current: 'one' }, mounted = { current: true };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, activeSong, mounted,
    localRemovalPlayback: { current: { songId: 'one', position: 80, wasPlaying: true } },
    p: { song: { duration: 180 }, player: { replace: () => calls.push('replace'), play: () => calls.push('play') } },
    streamURL: () => 'https://bridge.test/stream/one',
    invalidatePlaybackSeeks: async () => {},
    seekPlayback: async (_, position) => calls.push(['seek', position]),
    setTimeout: fn => timers.push(fn), Alert: { alert: () => calls.push('alert') },
  });
  return { ...exports, calls, timers, activeSong, mounted };
}
(async () => {
  for (const interrupted of ['song', 'unmount']) {
    const s = setup(); const work = s.restore(); await flush();
    assert.deepEqual(s.calls, ['replace']);
    if (interrupted === 'song') s.activeSong.current = 'two'; else s.mounted.current = false;
    s.timers.shift()(); await work;
    assert.deepEqual(s.calls, ['replace'], 'old removal must not seek/play the newly selected track or unmounted player');
  }
  const s = setup(); const work = s.restore(); await flush(); s.timers.shift()(); await work;
  assert.deepEqual(s.calls, ['replace', ['seek', 80], 'play']);
  await s.restore();
  assert.equal(s.calls.length, 3, 'removal snapshot is consumed once');
  console.log('Local removal: track change/unmount during restore cannot seek or resume another song.');
})().catch(error => { console.error(error); process.exitCode = 1; });
