const assert = require('node:assert/strict');
const fs = require('node:fs');
const { patchAudioUtils, audioUtilsPath, replacement } = require('../plugins/withPreciseAudioTiming');

const original = `    var options: [String: Any]?
    if let headers = source.headers {
      options = ["AVURLAssetHTTPHeaderFieldsKey": headers]
    }`;
const factory = original + '\n\n    let asset = AVURLAsset(url: finalUrl, options: options)';
const patched = patchAudioUtils(factory);
assert(patched.includes('AVURLAssetPreferPreciseDurationAndTimingKey: true'));
assert(patched.includes('options["AVURLAssetHTTPHeaderFieldsKey"] = headers'), 'headers must not overwrite the timing flag');
assert(patched.includes('AVURLAsset(url: finalUrl, options: options)'));
assert.equal(patchAudioUtils(patched), patched, 'prebuild is idempotent');
assert.equal(patchAudioUtils(factory.replace(/\n/g, '\r\n')), patched);
assert.equal(patched.replace(replacement, original), factory, 'only the asset options change');
assert.throws(() => patchAudioUtils('unexpected upstream source'), /unsupported/);
assert.throws(() => patchAudioUtils(factory + factory), /unsupported/);
assert.throws(() => patchAudioUtils(factory + '\nAVURLAssetPreferPreciseDurationAndTimingKey'), /unsupported/);

const actual = fs.readFileSync(audioUtilsPath(process.cwd()), 'utf8');
assert(patchAudioUtils(actual).includes(replacement), 'patch supports the installed native dependency');
if (process.argv.includes('--verify-installed')) {
  assert(actual.replace(/\r\n/g, '\n').includes(replacement), 'iOS prebuild must apply the patch before compiling');
}
const config = require('../app.json');
assert(config.expo.plugins.includes('./plugins/withPreciseAudioTiming'));
console.log('Precise audio timing: native asset option, HTTP headers, idempotence, upstream guard and build registration passed.');
