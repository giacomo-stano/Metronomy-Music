const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const api = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/playbackSource.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: api });

(async () => {
  let remoteCalls = 0;
  const remote = id => { remoteCalls++; return 'https://server.test/stream/' + id; };
  for (const offline of [false, true]) {
    const source = await api.playbackSource('song', offline, async () => 'file:///local.flac', remote);
    assert.equal(source.uri, 'file:///local.flac');
  }
  assert.equal(remoteCalls, 0, 'downloaded songs do not stream even when online');
  assert.equal((await api.playbackSource('song', false, async () => undefined, remote)).uri, 'https://server.test/stream/song');
  assert.equal(remoteCalls, 1);
  await assert.rejects(api.playbackSource('song', true, async () => undefined, remote), /non è disponibile/);
  const failed = async () => { throw Error('local unavailable'); };
  await assert.rejects(api.playbackSource('song', true, failed, remote), /local unavailable/);
  assert.equal(remoteCalls, 1, 'missing/broken offline files must never fall back to a network URL');
  assert.equal((await api.playbackSource('song', false, failed, remote)).uri, 'https://server.test/stream/song');
  console.log('Playback source: verified local files preferred online/offline, network fallback only online, source object passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
