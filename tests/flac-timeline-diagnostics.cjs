const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const api = {};
const clock = { now: () => 1000 };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/playbackTimelineDiagnostics.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: api, Date, Number, Math });

api.clearTimelineSamples();
api.captureTimeline('prima seek 99%', {
  duration: 420, currentTime: 417, playing: true, isBuffering: false,
}, 436.587);
let samples = api.timelineSamples();
assert.equal(samples.length, 1);
assert.equal(samples[0].nativeDuration, 420);
assert.equal(samples[0].catalogDuration, 436.587);
assert.equal(samples[0].nativePosition, 417);
assert.equal(samples[0].playing, true);
samples[0].nativePosition = 0;
assert.equal(api.timelineSamples()[0].nativePosition, 417, 'snapshot is immutable from caller');

for (let i=0; i<35; i++) api.captureTimeline('vicino alla fine', {
  duration: i, currentTime: i + 1, playing: true, isBuffering: false,
}, 436.587);
assert.equal(api.timelineSamples().length, 30, 'bounded in-memory history');
api.captureTimeline('bad', { duration: NaN, currentTime: Infinity }, NaN);
assert.equal(api.timelineSamples()[0].nativeDuration, 0);

const sheet = fs.readFileSync('src/PlayerSheet.tsx', 'utf8');
assert(sheet.includes("captureTimeline('prima seek '"));
assert(sheet.includes("captureTimeline('seek completato '"));
assert(sheet.includes("captureTimeline('1.5s dopo seek'"));
assert(sheet.includes("captureTimeline('vicino alla fine'"));
const settings = fs.readFileSync('src/SettingsScreen.tsx','utf8');
assert(settings.includes("Diagnostica FLAC e seek"));
console.log('FLAC timeline diagnostic sampling is bounded, anonymous, preserves raw native positions and is displayed in Settings.');
