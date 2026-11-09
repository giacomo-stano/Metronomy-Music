const assert = require('node:assert/strict');
const fs = require('node:fs');
const { patchAudioUtils, patchStartupKeys, audioUtilsPath, replacement, standardReplacement } = require('../plugins/withPreciseAudioTiming');

const original = `    var options: [String: Any]?
    if let headers = source.headers {
      options = ["AVURLAssetHTTPHeaderFieldsKey": headers]
    }`;
const factory = original + '\n\n    let asset = AVURLAsset(url: finalUrl, options: options)';
const precise = process.env.METRONOMY_PRECISE_AUDIO_TIMING !== 'false';
const patched = patchAudioUtils(factory, precise);
const selected = precise ? replacement : standardReplacement;
const standard = patchAudioUtils(factory, false);
assert(standard.includes('AVURLAssetPreferPreciseDurationAndTimingKey: false'));
assert.equal(patchAudioUtils(standard, false), standard);
assert.throws(() => patchAudioUtils(standard, true), /unsupported/);
assert(patched.includes('AVURLAssetPreferPreciseDurationAndTimingKey: ' + String(precise)));
assert(patched.includes('options["AVURLAssetHTTPHeaderFieldsKey"] = headers'), 'headers must not overwrite the timing flag');
assert(patched.includes('AVURLAsset(url: finalUrl, options: options)'));
assert.equal(patchAudioUtils(patched, precise), patched, 'prebuild is idempotent');
assert.equal(patchAudioUtils(factory.replace(/\n/g, '\r\n'), precise), patched);
assert.equal(patched.replace(selected, original), factory, 'only the asset options change');
assert.throws(() => patchAudioUtils('unexpected upstream source'), /unsupported/);
assert.throws(() => patchAudioUtils(factory + factory), /unsupported/);
assert.throws(() => patchAudioUtils(factory + '\nAVURLAssetPreferPreciseDurationAndTimingKey'), /unsupported/);

const actual = fs.readFileSync(audioUtilsPath(process.cwd()), 'utf8');
const startup = patchStartupKeys(patchAudioUtils(actual, precise));
assert(startup.includes('AVURLAssetPreferPreciseDurationAndTimingKey: ' + String(precise)), 'startup must use the requested timing mode');
assert(startup.includes('return AVPlayerItem(asset: asset, automaticallyLoadedAssetKeys: [.tracks])'), 'duration indexing must not gate first playback');
assert(!startup.includes('automaticallyLoadedAssetKeys: [.tracks, .duration]'));
assert.equal(patchStartupKeys(startup), startup);
assert.throws(() => patchStartupKeys('unknown factory'), /unsupported/);
assert(patchAudioUtils(actual, precise).includes(selected), 'patch supports the installed native dependency');
if (process.argv.includes('--verify-installed')) {
  assert(actual.replace(/\r\n/g, '\n').includes(selected), 'iOS prebuild must apply the patch before compiling');
  assert.equal(patchStartupKeys(actual), actual, 'iOS prebuild must apply nonblocking readiness');
}
const config = require('../app.json');
assert(config.expo.plugins.includes('./plugins/withPreciseAudioTiming'));
console.log('Audio timing (' + (precise ? 'precise' : 'standard') + '): native asset option, HTTP headers, idempotence, upstream guard and build registration passed.');
