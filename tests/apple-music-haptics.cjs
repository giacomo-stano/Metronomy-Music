const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const api = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/appleMusicHaptics.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: api, Date, setTimeout, clearTimeout });
const { normalizeISRC, detailISRC, AppleHapticsSession, hapticsLabel, withTimeout } = api;
const A = 'DEE861902725', B = 'USUM71703861';
const track = (id = 'a', isrc) => ({ id, title: id, artist: 'Artist', isrc });
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(read = async () => ({ info: { isrc: [A] } }), timeout = 100) {
  let nativeState = { key: '', supported: true, active: true, playing: false, nativeIsrc: '',
    nowPlayingReady: false, audioPlaying: false, observerRegistered: false };
  const writes = [], updates = [];
  const native = {
    async beginTrack(key) { nativeState = { ...nativeState, key, nativeIsrc: '', playing: false,
      nowPlayingReady: false, audioPlaying: false, observerRegistered: false }; return { ...nativeState }; },
    async setISRC(key, isrc) { if (key === nativeState.key) {
      nativeState.nativeIsrc = isrc; nativeState.nowPlayingReady = true;
      nativeState.audioPlaying = true; nativeState.observerRegistered = true; writes.push(isrc);
    } return { ...nativeState }; },
    async getState() { return { ...nativeState }; },
    async checkAvailability() { return true; },
    async clearTrack(key) { if (key === nativeState.key) nativeState.key = ''; },
  };
  const session = new AppleHapticsSession(native, read, value => updates.push(value), timeout);
  return { session, native, writes, updates, state: () => nativeState };
}
(async () => {
  assert.equal(normalizeISRC(' de-e86-19-02725 '), A);
  for (const value of [undefined, null, {}, 42, '123456789012', 'DEE86?1902725', '']) assert.equal(normalizeISRC(value), '');
  assert.equal(normalizeISRC(['bad', A]), A);
  assert.equal(detailISRC({ isrc: '', info: { isrc: ['bad'], ISRC: A } }), A);
  assert.equal(detailISRC({ song: { isrc: B } }), B);

  const f = fixture();
  await f.session.select(track());
  assert.equal(f.session.state.isrc, A);
  assert.equal(f.session.state.available, true);
  assert.equal(f.session.state.playing, false, 'catalog availability is not proof of playback');
  assert.equal(hapticsLabel(f.session.state), 'Music Haptics attivo');
  f.session.accept({ ...f.state(), playing: true, audioPlaying: true });
  assert.equal(hapticsLabel(f.session.state), 'Music Haptics in riproduzione');
  f.session.accept({ ...f.state(), active: false, playing: false });
  assert.equal(hapticsLabel(f.session.state), 'Music Haptics disattivato');
  const count = f.updates.length;
  f.session.accept({ ...f.state(), key: 'stale', playing: true });
  assert.equal(f.updates.length, count, 'ignore events belonging to old tracks/accounts');

  let finish;
  const race = fixture(() => new Promise(resolve => finish = resolve));
  const old = race.session.select(track('old'));
  await tick();
  await race.session.select(track('new', B));
  finish({ info: { isrc: A } }); await old;
  assert.equal(race.writes.join(','), B, 'late old-song lookup cannot overwrite current ISRC');
  assert.equal(race.session.state.isrc, B);

  let availability;
  race.native.checkAvailability = () => new Promise(resolve => availability = resolve);
  const pending = race.session.select(track('pending', A));
  await tick();
  race.native.checkAvailability = async () => false;
  await race.session.select(track('newest', B));
  availability(true); await pending;
  assert.equal(race.session.state.available, false, 'late Apple response must be ignored');

  const missing = fixture(async () => ({ info: {} }));
  await missing.session.select(track());
  assert.equal(missing.session.state.phase, 'missing-isrc');
  assert.equal(missing.writes.length, 0);
  const absent = new AppleHapticsSession(null, async () => { throw Error('must not fetch'); }, () => {});
  await absent.select(track()); assert.equal(absent.state.phase, 'native-missing');

  let attempts = 0;
  const retry = fixture(async () => { if (++attempts === 1) throw Error('offline'); return { info: { isrc: A } }; });
  await retry.session.select(track()); assert.equal(retry.session.state.phase, 'error');
  await retry.session.retry(); assert.equal(retry.session.state.phase, 'ready');
  const timeout = fixture(undefined, 5);
  timeout.native.checkAvailability = () => new Promise(() => {});
  await timeout.session.select(track()); assert.equal(timeout.session.state.phase, 'error', 'no indefinite checking state');
  await assert.rejects(withTimeout(new Promise(() => {}), 2));

  // Readback mismatch is recoverable independently of the catalog result.
  const settling = fixture();
  settling.native.setISRC = async () => ({ ...settling.state(), nativeIsrc: '' });
  await settling.session.select(track());
  assert.equal(settling.session.state.available, true);
  assert.equal(hapticsLabel(settling.session.state), 'Sincronizzazione aptica…');
  settling.native.getState = async () => ({ ...settling.state(), nativeIsrc: A });
  await settling.session.refresh(); assert.equal(settling.session.state.nativeIsrc, A);
  const stableCount = settling.updates.length;
  await settling.session.refresh(); assert.equal(settling.updates.length, stableCount, 'unchanged polling must not rerender app');
  settling.session.dispose(); await tick(); assert.equal(settling.state().key, '');

  let completeDisposed;
  const disposed = fixture(() => new Promise(resolve => completeDisposed = resolve));
  const outstanding = disposed.session.select(track()); await tick();
  disposed.session.dispose(); completeDisposed({ isrc: A }); await outstanding;
  assert.equal(disposed.writes.length, 0, 'logout cannot publish an old lookup');

  const swift = fs.readFileSync('modules/metronomy-audio-controls/ios/MetronomyMusicHapticsModule.swift', 'utf8');
  assert(!/import CoreHaptics|CHHapticEngine|hapticTransient/.test(swift));
  assert(swift.includes('.runOnQueue(.main)'));
  assert(swift.includes('restartPlaybackObserver'));
  assert(swift.includes('scheduleAttachmentRetry'));
  assert.equal(JSON.parse(fs.readFileSync('app.json')).expo.ios.infoPlist.MusicHapticsSupported, true);
  assert(JSON.parse(fs.readFileSync('modules/metronomy-audio-controls/expo-module.config.json')).apple.modules.includes('MetronomyMusicHapticsModule'));
  console.log('Apple Music Haptics: ISRC shapes, state semantics, native absence, retry/timeout, stale lookups/events, metadata recovery, cleanup and Apple-only configuration passed.');
})().catch(e => { console.error(e); process.exitCode = 1; });
