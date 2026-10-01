const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const api = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/playbackTimeline.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: api, WeakMap, Number, Math, Promise });
const { playbackTimeline, SeekQueue, seekPlayback, invalidatePlaybackSeeks } = api;
const tick = () => new Promise(resolve => setImmediate(resolve));

(async () => {
  let t = playbackTimeline({ currentTime: 200, duration: 240 }, 180);
  assert.equal(t.duration, 240, 'catalog must not terminate the native timeline early');
  assert.equal(t.remaining, 40);
  assert(t.progress < 1);
  t = playbackTimeline({ currentTime: 100, duration: 180 }, 240);
  assert.equal(t.remaining, 80, 'also prefer a shorter native duration');
  assert.equal(playbackTimeline({ currentTime: 5, duration: 0 }, 234).duration, 234);
  for (const bad of [NaN, Infinity, -1, undefined]) {
    assert.equal(playbackTimeline({ currentTime: bad, duration: bad }, 120).position, 0);
    assert.equal(playbackTimeline({ duration: bad }, 120).duration, 120);
  }
  for (const position of [0, 55, 200, 20, 239.9, 240, 250]) {
    t = playbackTimeline({ currentTime: position, duration: 240 }, 180);
    assert.equal(t.position + t.remaining, 240, 'both counters share the bar timeline after seeks');
    assert(t.progress >= 0 && t.progress <= 1);
  }
  assert.equal(playbackTimeline({ currentTime: 20, duration: 0 }).progress, 0);

  let pending = [], targets = [];
  const q = new SeekQueue(target => { targets.push(target); return new Promise((resolve, reject) => pending.push({ resolve, reject })); });
  const first = q.seek(90);
  await tick();
  const superseded = q.seek(20), last = q.seek(150);
  assert.equal(await superseded, false);
  assert.deepEqual(targets, [90], 'native seeks never overlap');
  pending.shift().resolve(); await tick();
  assert.equal(await first, false, 'a newer target supersedes the first result');
  assert.deepEqual(targets, [90, 150]);
  pending.shift().resolve();
  assert.equal(await last, true);
  await tick();

  const old = q.seek(40); await tick();
  const queued = q.seek(50);
  let drained = false;
  const barrier = q.invalidate().then(() => { drained = true; });
  assert.equal(await queued, false);
  assert.equal(await q.seek(70), false, 'no new seek while source replacement is waiting');
  assert.equal(drained, false);
  pending.shift().resolve(); await barrier;
  assert.equal(await old, false);
  assert.deepEqual(targets, [90, 150, 40], 'cancelled queued target never reaches the player');
  const failure = q.seek(80); const rejected = assert.rejects(failure, /native failed/);
  await tick(); pending.shift().reject(Error('native failed')); await rejected; await tick();
  const recovery = q.seek(10); await tick(); pending.shift().resolve(); assert.equal(await recovery, true);
  assert.equal(await q.seek(NaN), false);

  const calls = [];
  const player = { currentStatus: { duration: 240, isLoaded: true },
    seekTo: async (...args) => { calls.push(args); } };
  assert.equal(await seekPlayback(player, 200, 180), true);
  assert.deepEqual(calls[0], [200, 0, 0], 'seek uses native duration and zero tolerance');
  await tick(); await seekPlayback(player, 999, 180);
  assert.deepEqual(calls[1], [240, 0, 0]);
  await tick(); await seekPlayback(player, -10);
  assert.deepEqual(calls[2], [0, 0, 0]);
  player.currentStatus.isLoaded = false;
  assert.equal(await seekPlayback(player, 20), false);
  await invalidatePlaybackSeeks(player);

  const sheet = fs.readFileSync('src/PlayerSheet.tsx', 'utf8');
  const app = fs.readFileSync('App.tsx', 'utf8');
  assert(!sheet.includes('catalogDuration || playerDuration'));
  assert(!sheet.includes('.seekTo(') && !app.includes('.seekTo('), 'app seek entry points use one queue');
  assert(app.indexOf('await invalidatePlaybackSeeks(player)') < app.indexOf('player.replace(source)'));
  assert(sheet.includes('value={progress}'));
  console.log('Playback timeline: native/catalog durations, invalid values, counters, forward/back/end seeks, serialization, coalescing, track replacement and error recovery passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
