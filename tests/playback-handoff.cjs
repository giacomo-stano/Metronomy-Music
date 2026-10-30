const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const api = {}, timers = new Map(); let timerId = 0;
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/playbackHandoff.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: api, setTimeout: f => { timers.set(++timerId, f); return timerId; }, clearTimeout: id => timers.delete(id) });
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
const status = extra => ({ isLoaded: false, playing: false, error: null, playbackState: 'unknown', ...extra });
function fakePlayer() {
  const listeners = new Set();
  return {
    listeners, currentStatus: status(), plays: 0, sources: [],
    addListener(event, cb) { assert.equal(event, 'playbackStatusUpdate'); listeners.add(cb); return { remove: () => listeners.delete(cb) }; },
    emit(extra) { this.currentStatus = status(extra); for (const cb of [...listeners]) cb(this.currentStatus); },
    replace(source) { this.sources.push(source.uri); this.currentStatus = status(); this.onReplace?.(source); },
    play() { this.plays++; this.onPlay?.(); this.emit({ isLoaded: true, playing: true }); },
  };
}
const source = { uri: 'https://example.test/prepared' }, fresh = { uri: 'https://example.test/fresh' };
(async () => {
  let p = fakePlayer(), c = new AbortController(), installed = 0;
  let result = api.replaceAndPlay(p, source, c.signal, () => installed++);
  assert.equal(p.plays, 0, 'do not lose play intent while a new item is not ready');
  p.emit({ isLoaded: false }); assert.equal(p.plays, 0);
  p.emit({ isLoaded: true }); await result;
  assert.equal(installed, 1); assert.equal(p.plays, 1, 'play reentrant status must not trigger play recursively');
  p.emit({ isLoaded: true, playing: false }); assert.equal(p.plays, 1, 'user pause must remain paused');
  assert.equal(p.listeners.size, 0); assert.equal(timers.size, 0);

  p = fakePlayer(); c = new AbortController(); let completed = false;
  p.play = function () { this.plays++; this.emit({ isLoaded: true, playing: false }); };
  result = api.replaceAndPlay(p, source, c.signal, () => {}).then(() => { completed = true; });
  p.emit({ isLoaded: true }); await flush();
  assert.equal(completed, false, 'ready alone is not confirmation that Qobuz is playing');
  assert.equal(p.plays, 1, 'reentrant ready events must not loop');
  p.emit({ isLoaded: true, playing: true }); await result;
  assert.equal(completed, true);

  p = fakePlayer(); c = new AbortController();
  p.onReplace = () => p.emit({ isLoaded: true });
  await api.replaceAndPlay(p, { uri: 'file:///track.flac' }, c.signal, () => {});
  assert.equal(p.plays, 1, 'local/prepared items already ready at replace are started');

  p = fakePlayer(); c = new AbortController();
  p.onReplace = () => { p.emit({ error: 'old item' }); p.currentStatus = status(); };
  result = api.replaceAndPlay(p, source, c.signal, () => {});
  p.emit({ isLoaded: true }); await result;
  assert.equal(p.plays, 1, 'ignore statuses emitted while replace is still changing the item');

  p = fakePlayer(); c = new AbortController();
  result = api.replaceAndPlay(p, source, c.signal, () => {});
  const cancelled = assert.rejects(result, /annullata/);
  c.abort(); p.emit({ isLoaded: true }); await cancelled;
  assert.equal(p.plays, 0); assert.equal(p.listeners.size, 0); assert.equal(timers.size, 0);
  await assert.rejects(api.replaceAndPlay(p, fresh, c.signal, () => {}), /annullata/);
  assert.equal(p.sources.length, 1, 'already cancelled requests must never replace');

  p = fakePlayer(); c = new AbortController();
  result = api.replaceAndPlay(p, source, c.signal, () => {});
  const timedOut = assert.rejects(result, /troppo tempo/);
  for (const fn of [...timers.values()]) fn(); await timedOut;
  assert.equal(p.listeners.size, 0); assert.equal(timers.size, 0);

  function options(player, signal, events = []) {
    return { player, source, signal, installed: () => events.push('installed'), retrying: () => events.push('retry'),
      discard: async () => { events.push('discard'); }, freshSource: async () => { events.push('fresh'); return fresh; },
      resolved: (s, retried) => events.push(retried ? 'resolved-fresh' : 'resolved-prepared') };
  }
  for (const failure of ['replace', 'native-status', 'play', 'after-play']) {
    p = fakePlayer(); c = new AbortController(); const events = [];
    p.onReplace = () => {
      if (p.sources.length === 1 && failure === 'replace') throw Error('Exception in HostFunction: <unknown>');
      if (p.sources.length > 1 || failure === 'play' || failure === 'after-play') p.currentStatus = status({ isLoaded: true });
    };
    p.onPlay = () => { if (p.sources.length === 1 && failure === 'play') throw Error('HostFunction'); };
    if (failure === 'after-play') p.play = function () {
      this.plays++;
      this.emit({ isLoaded: true, playing: this.sources.length > 1 });
    };
    result = api.startPlaybackWithRecovery(options(p, c.signal, events));
    if (failure === 'native-status' || failure === 'after-play') p.emit({ error: 'unavailable signed URL' });
    await result;
    assert.deepEqual(p.sources, [source.uri, fresh.uri]);
    assert(events.indexOf('discard') < events.indexOf('fresh'), 'evict native preload before obtaining a fresh URL');
    assert.equal(events.filter(e => e === 'retry').length, 1);
    assert.equal(p.listeners.size, 0); assert.equal(timers.size, 0);
  }

  // A real error gets only one retry, then rejects instead of silently pausing.
  p = fakePlayer(); c = new AbortController();
  p.onReplace = () => { throw Error('HostFunction'); };
  await assert.rejects(api.startPlaybackWithRecovery(options(p, c.signal)), /HostFunction/);
  assert.equal(p.sources.length, 2); assert.equal(p.listeners.size, 0);

  // New track selection / logout during URL refresh must discard late results.
  p = fakePlayer(); c = new AbortController(); const wait = deferred();
  p.onReplace = () => { throw Error('HostFunction'); };
  result = api.startPlaybackWithRecovery({ ...options(p, c.signal), freshSource: () => wait.promise });
  const late = assert.rejects(result, /annullata/);
  await flush(); c.abort(); wait.resolve(fresh); await late;
  assert.equal(p.sources.length, 1); assert.equal(p.plays, 0);

  p = fakePlayer(); c = new AbortController(); const evict = deferred(); let resolves = 0;
  p.onReplace = () => { throw Error('HostFunction'); };
  result = api.startPlaybackWithRecovery({ ...options(p, c.signal), discard: () => evict.promise,
    freshSource: async () => { resolves++; return fresh; } });
  const stopped = assert.rejects(result, /annullata/);
  await flush(); c.abort(); evict.resolve(); await stopped;
  assert.equal(resolves, 0, 'cancel before fresh URL request');

  // Exercise the actual EOF observer and handoff together across a queue.
  const eof = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/playbackCompletion.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports: eof });
  p = fakePlayer(); let active = 1, index = 0, pending;
  const tracks = [source, fresh, { uri: 'file:///third.flac' }];
  const sub = eof.observePlaybackCompletion(p, () => active, () => {
    if (index + 1 >= tracks.length) return;
    active = null;
    const selected = ++index;
    pending = api.startPlaybackWithRecovery({ ...options(p, new AbortController().signal),
      source: tracks[selected], freshSource: async () => tracks[selected],
    }).then(() => { active = selected + 1; });
  });
  const finish = () => p.emit({ isLoaded: true, playing: false, currentTime: 60, duration: 60, didJustFinish: true });
  finish(); finish(); // Old-item EOF duplicate during replacement.
  assert.equal(index, 1); assert.equal(p.plays, 0);
  p.emit({ isLoaded: true }); await pending;
  assert.equal(p.plays, 1);
  finish(); p.emit({ isLoaded: true }); await pending;
  assert.equal(p.plays, 2); assert.equal(index, 2);
  finish(); assert.equal(index, 2, 'end of queue must not restart');
  sub.remove(); assert.equal(p.listeners.size, 0);

  assert.equal(timers.size, 0);
  const app = fs.readFileSync('App.tsx', 'utf8');
  const start = app.slice(app.indexOf('  async function start('), app.indexOf('  const seek ='));
  assert(start.includes('await startPlaybackWithRecovery('));
  assert(start.includes('signal: controller.signal'));
  assert(start.indexOf('activeAudioGeneration.current = version') > start.indexOf('await startPlaybackWithRecovery('),
    'old EOF must not advance the new item while its readiness is pending');
  console.log('Playback handoff: readiness, local/cached assets, reentrancy, HostFunction/native failures, bounded retry, pause and cancellation passed.');
})().catch(e => { console.error(e); process.exitCode = 1; });
