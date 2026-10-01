const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const api = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/nativeHapticsDiagnostic.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: api });
const { withExclusiveDiagnostic } = api;
function fixture() {
  const events = [];
  return { events, busy: { current: false }, isCurrent: () => true,
    suspend: () => events.push('pause-and-detach'), settle: async () => events.push('settle'),
    open: async () => { events.push('native'); return 'report'; },
    restorePaused: () => events.push('restore-paused'),
  };
}
(async () => {
  const ok = fixture();
  assert.equal(await withExclusiveDiagnostic(ok), 'report');
  assert.deepEqual(ok.events, ['pause-and-detach', 'settle', 'native', 'restore-paused']);
  assert.equal(ok.busy.current, false);
  for (const failure of ['suspend', 'settle', 'open', 'restorePaused']) {
    const test = fixture();
    test[failure] = () => { throw Error('test failure'); };
    await assert.rejects(withExclusiveDiagnostic(test));
    assert.equal(test.busy.current, false, failure + ' must release the lock');
    if (failure !== 'restorePaused') assert(test.events.includes('restore-paused'));
  }
  const stale = fixture();
  stale.settle = async () => { stale.isCurrent = () => false; };
  assert.equal(await withExclusiveDiagnostic(stale), undefined);
  assert.deepEqual(stale.events, ['pause-and-detach'], 'unmount or new track must not restore old metadata');
  const busy = fixture();
  let finish;
  busy.open = () => new Promise(resolve => { finish = resolve; });
  const first = withExclusiveDiagnostic(busy);
  await Promise.resolve();
  assert.equal(await withExclusiveDiagnostic(busy), undefined, 'double tap must not start another player');
  finish('done'); await first;
  assert.equal(busy.events.filter(e => e === 'restore-paused').length, 1);

  const swift = fs.readFileSync('modules/metronomy-audio-controls/ios/MetronomyHapticsDiagnosticModule.swift', 'utf8');
  assert(!/CoreHaptics|CHHaptic|URLSession|print\(/.test(swift));
  assert(swift.includes('AVPlayerItem(url: url)'));
  assert(swift.indexOf('addStatusObserver') < swift.indexOf('player?.play()'));
  assert(swift.includes('didEnterBackgroundNotification'));
  assert(swift.includes('- startTime >= 60'));
  assert(swift.includes('removeStatusObserver(observer)'));
  assert(swift.includes('command.removeTarget(target)'));
  const report = swift.split('private func report()')[1].split('private func render()')[0];
  assert(!/absoluteString|localizedDescription|trackTitle|artist|error\.userInfo/.test(report), 'report must omit URLs and free-form errors');
  assert(JSON.parse(fs.readFileSync('modules/metronomy-audio-controls/expo-module.config.json')).apple.modules.includes('MetronomyHapticsDiagnosticModule'));
  console.log('Native diagnostic: exclusive handoff, failures, stale ownership, concurrency, Apple-only and privacy checks passed.');
})().catch(e => { console.error(e); process.exitCode = 1; });
