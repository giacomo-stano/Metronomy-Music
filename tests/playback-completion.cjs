const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const api = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/playbackCompletion.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: api });
let emit, removed = false, session = 1, advances = 0;
const player = { addListener(name, callback) {
  assert.equal(name, 'playbackStatusUpdate');
  emit = callback;
  return { remove() { removed = true; } };
} };
const subscription = api.observePlaybackCompletion(player, () => session, () => advances++);
const status = (extra = {}) => ({ currentTime: 30, duration: 60, playing: true,
  didJustFinish: false, isLoaded: true, isBuffering: false, ...extra });
emit(status());
emit(status({ playing: false })); // Pause is not EOF.
emit(status({ playing: false, isBuffering: true }));
emit(status({ currentTime: 65 })); // Never guess EOF from the timeline.
assert.equal(advances, 0);
emit(status({ playing: false, currentTime: 60, didJustFinish: true }));
emit(status({ playing: false, currentTime: 60 })); // Same React batch resets flag.
assert.equal(advances, 1, 'EOF must be consumed without waiting for a React render');
emit(status({ playing: false, currentTime: 60, didJustFinish: true }));
assert.equal(advances, 1, 'duplicate EOF must not skip a song');
session = null;
emit(status({ didJustFinish: true }));
assert.equal(advances, 1, 'ignore old EOF while replacing the source or logging out');
session = 2;
emit(status({ playing: false, isBuffering: true, currentTime: 0 }));
emit(status({ currentTime: 0 }));
emit(status({ didJustFinish: true, playing: false, currentTime: 60 }));
assert.equal(advances, 2, 'the next source gets its own completion');
emit(status({ currentTime: 0 })); // Replay/seek to the start.
emit(status({ didJustFinish: true, playing: false, currentTime: 60 }));
assert.equal(advances, 3, 'replaying the last source can finish again');
subscription.remove();
assert(removed);
const app = fs.readFileSync('App.tsx', 'utf8');
assert(/useAudioPlayer\(null,\s*\{[^}]*keepAudioSessionActive:\s*true/.test(app),
  'EOF must not deactivate iOS audio while the next item is buffering');
assert(app.includes('observePlaybackCompletion('));
assert(!/useEffect\(\(\) => \{ if \(status.didJustFinish/.test(app),
  'render effects must not also advance the queue');
assert(app.includes("if (repeat !== 'one') next()"), 'native repeat-one must not advance');
const dock = fs.readFileSync('modules/metronomy-audio-controls/ios/MetronomyDockView.swift', 'utf8');
assert(!dock.includes('UIActivityIndicatorView') && !dock.includes('play.imageView?.isHidden'),
  'play must remain visible without an overlapping spinner');
const catalog = fs.readFileSync('src/CatalogBrowser.tsx', 'utf8');
assert(!/playBusy\s*\?\s*<ActivityIndicator/.test(catalog));
const config = JSON.parse(fs.readFileSync('app.json', 'utf8'));
const icon = config.expo.icon.replace('./', '../');
assert(fs.readFileSync('src/LoginScreen.tsx', 'utf8').includes("require('" + icon + "')"));
console.log('Playback completion: batched EOF, duplicate/stale events, buffering, pause, replay and session handoff passed; login and play controls verified.');
