const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const api = {};
let fetchImpl, fetches = 0, expirations = 0;
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/api.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: api, URL, AbortController, setTimeout, clearTimeout,
  fetch: (...args) => { fetches++; return fetchImpl(...args); } });
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
const online = { username: 'one', baseURL: 'https://bridge.test', token: 'test', offline: false };
const response = (json, status = 200) => ({ ok: status === 200, status, headers: { get: () => null }, json });

(async () => {
  api.configureAccount(online);
  api.onSessionExpired(() => expirations++);
  const body = deferred(), reading = deferred(), abort = new AbortController();
  fetchImpl = async () => response(() => { reading.resolve(); return body.promise; });
  const pending = api.request('home', 1000, undefined, { signal: abort.signal });
  await reading.promise;
  abort.abort(); body.resolve({ songs: ['obsolete'] });
  await assert.rejects(pending, /annullata/, 'abort while decoding must not return stale data');

  const before = fetches;
  await assert.rejects(api.request('home', 1000, undefined, { signal: abort.signal }), /annullata/);
  assert.equal(fetches, before, 'already cancelled calls never start I/O');

  const offlineBody = deferred(), offlineReading = deferred(), offlineAbort = new AbortController();
  api.configureAccount({ ...online, offline: true });
  api.configureLocal({ read: () => { offlineReading.resolve(); return offlineBody.promise; }, cover: () => undefined });
  const offline = api.request('home', 1000, undefined, { signal: offlineAbort.signal });
  await offlineReading.promise;
  offlineAbort.abort(); offlineBody.resolve({ songs: ['old-local-selection'] });
  await assert.rejects(offline, /annullata/, 'offline reads obey the same cancellation contract');
  assert.equal(fetches, before);

  api.configureAccount(online);
  const oldResponse = deferred(); fetchImpl = () => oldResponse.promise;
  const oldSession = api.request('home');
  api.configureAccount({ ...online, username: 'two' });
  oldResponse.resolve(response(async () => ({}), 401));
  await assert.rejects(oldSession, /Account cambiato/);
  assert.equal(expirations, 0, 'an old 401 must not expire the new account');
  fetchImpl = async () => response(async () => ({ songs: ['current'] }));
  assert.equal((await api.request('home')).songs[0], 'current');
  console.log('Request lifecycle: decode/local cancellation and stale account responses passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
