const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { patchRecords, patchController } = require('../plugins/withMusicHapticsMetadata');

const records = fs.readFileSync('node_modules/expo-audio/ios/AudioRecords.swift', 'utf8');
const controller = fs.readFileSync('node_modules/expo-audio/ios/MediaController.swift', 'utf8');
const patchedRecords = patchRecords(records), patchedController = patchController(controller);
assert.equal(patchRecords(patchedRecords), patchedRecords, 'prebuild patch is idempotent');
assert.equal(patchController(patchedController), patchedController);
assert.throws(() => patchRecords('struct Changed {}'), /source changed/);
assert.throws(() => patchController('class Changed {}'), /source changed/);
assert(patchedRecords.includes('@Field var metronomyISRC: String?'));
assert(patchedRecords.includes('@Field var metronomyDuration: Double?'));
assert(patchedController.includes('applyMetronomyMetadata(&nowPlayingInfo, for: player)\n    nowPlayingInfoCenter.nowPlayingInfo = nowPlayingInfo'));
assert(patchedController.includes('duration.isFinite && duration > 0'));
assert(patchedController.includes('info[MPNowPlayingInfoPropertyIsLiveStream] = false'));
assert(patchedController.includes('removeValue(forKey: MPNowPlayingInfoPropertyInternationalStandardRecordingCode)'));
assert(patchedController.includes('latestNowPlayingInfo[MPMediaItemPropertyArtwork] = artwork'));
assert(JSON.parse(fs.readFileSync('app.json')).expo.plugins.includes('./plugins/withMusicHapticsMetadata'));

function load(file, requireFn) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, require: requireFn, Date, setTimeout, clearTimeout });
  return exports;
}
const haptics = load('src/appleMusicHaptics.ts');
const { nowPlayingMetadata } = load('src/nowPlayingMetadata.ts', () => haptics);
const song = { id: 'song', title: 'Creep in a T-Shirt', artist: 'Portugal. The Man',
  duration: 233, isrcs: ['bad', 'USAT21300493'] };
const metadata = nowPlayingMetadata(song, 'https://example.test/art');
assert.equal(metadata.metronomyISRC, 'USAT21300493');
assert.equal(metadata.metronomyDuration, 233);
assert.equal(metadata.metronomyTrackId, song.id);
assert.equal(nowPlayingMetadata({ ...song, isrcs: [] }).metronomyISRC, '');
assert.equal(nowPlayingMetadata({ ...song, duration: Infinity }).metronomyDuration, 0);
assert.equal(nowPlayingMetadata(song, undefined, 'DEE861902725').metronomyISRC, 'DEE861902725');
console.log('Now Playing: owner metadata, native patch/idempotence/drift guards, timeline fallback and ISRC clearing passed.');
