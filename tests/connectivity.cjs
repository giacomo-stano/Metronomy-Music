const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const compile = text => ts.transpileModule(text, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const tick = async () => { for (let i = 0; i < 12; i++) await new Promise(setImmediate); };
const online = { username: 'one', baseURL: 'https://bridge.test', token: 'token', expires: 9999999999, destinations: [], admin: false };
const app = ts.createSourceFile('App.tsx', fs.readFileSync('App.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const gate = app.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'AccountGate');
assert(gate);
let response = async () => ({ ok: true, status: 200 });
let profileRead = async () => [{ ...online, count: 1 }];
let saved = JSON.stringify(online), states = [], effects = [], index = 0, pending = [];
const intervals = new Map(); let timerId = 0;
const context = vm.createContext({
  exports: {}, Error, URL, AbortController,
  fetch: (...args) => response(...args),
  setTimeout: (callback, ms) => { if (ms === 250) setImmediate(callback); return ++timerId; },
  clearTimeout: () => {},
  setInterval: (callback, ms) => { const id = ++timerId; intervals.set(id, { callback, ms }); return id; },
  clearInterval: id => intervals.delete(id),
  useState: initial => { const i = index++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
  useEffect: (callback, deps) => {
    const i = index++, old = effects[i];
    if (!old || deps.some((value, j) => value !== old.deps[j])) {
      old?.cleanup?.(); effects[i] = { deps }; pending.push(() => { effects[i].cleanup = callback(); });
    }
  },
  AsyncStorage: { getItem: async () => saved, setItem: async (_, value) => { saved = value; }, removeItem: async () => { saved = null; } },
  AppState: { addEventListener: () => ({ remove() {} }) },
  offlineProfiles: () => profileRead(),
  offlineAccount: p => ({ ...p, offline: true, token: '', expires: 0, admin: false, destinations: [] }),
  ACCOUNT_STORAGE_KEY: 'metronomy.activeAccount.v1',
  OfflineProvider: 'OfflineProvider', MusicApp: 'MusicApp', LoginScreen: 'LoginScreen',
  SafeAreaView: 'SafeAreaView', ActivityIndicator: 'ActivityIndicator',
  require: () => ({ jsx: (type, props, key) => ({ type, props, key }) }),
});
vm.runInContext(compile(fs.readFileSync('src/api.ts', 'utf8')), context);
const api = context.exports;
Object.assign(context, api);
vm.runInContext(compile(gate.getText(app)), context);
function render() { index = 0; const result = context.AccountGate(); const queue = pending; pending = []; queue.forEach(run => run()); return result; }
function interval(ms) { const entry = [...intervals.values()].find(item => item.ms === ms); assert(entry); return entry.callback(); }
const music = view => view.props.children.props;
async function fresh() {
  effects.forEach(effect => effect?.cleanup?.()); states = []; effects = []; pending = []; intervals.clear();
  saved = JSON.stringify(online); response = async () => ({ ok: true, status: 200 });
  profileRead = async () => [{ ...online, count: 1 }]; api.configureAccount(null);
  render(); await tick(); return render();
}
(async () => {
  const network = new Error('Network request failed');
  assert(api.isConnectivityFailure(network));
  assert(api.isConnectivityFailure(new Error('fetch failed')));
  assert(!api.isConnectivityFailure(new TypeError('Unexpected property')));
  assert(!api.isConnectivityFailure(new Error('Sessione scaduta. Accedi nuovamente.')));
  response = async () => ({ ok: false, status: 401 });
  assert(await api.probeConnectivity(online), 'HTTP errors still mean the server is reachable');
  assert.equal(await api.probeAccount(online), false, 'invalid session is not restored');
  response = async () => { throw network; };
  assert.equal(await api.probeConnectivity(online), false);

  let view = await fresh();
  api.configureLocal({ read: async () => ({ songs: ['cached'] }), cover: () => 'file:///cover.jpg' });
  let attempts = 0;
  response = async () => { if (++attempts === 1) throw network; return { ok: true }; };
  await interval(4000);
  await tick();
  assert(!api.currentAccount().offline, 'single transient failure does not switch mode');
  response = async () => { throw network; };
  await interval(4000);
  await tick();
  assert(api.currentAccount().offline, 'two failed probes switch automatically without navigation');
  assert.equal((await api.request('home')).songs[0], 'cached', 'local access survives same-account transition');
  const offlineView = render(); await tick();
  assert.equal(offlineView.key, view.key, 'player/provider remain mounted during transition');
  response = async () => ({ ok: true, status: 200 });
  await interval(15000);
  await tick();
  assert(!api.currentAccount().offline, 'valid saved session reconnects automatically');
  assert.equal(api.coverURL('cover'), 'file:///cover.jpg', 'cached artwork survives reconnect');

  view = await fresh();
  profileRead = async () => [{ ...online, username: 'other', count: 1 }];
  assert.equal(await music(view).onOffline(), false, 'another account cannot provide fallback');
  let completeProfiles;
  profileRead = () => new Promise(resolve => { completeProfiles = resolve; });
  const pendingOffline = music(view).onOffline(); music(view).onLogout();
  completeProfiles([{ ...online, count: 1 }]);
  assert.equal(await pendingOffline, false);
  assert.equal(api.currentAccount(), null, 'pending offline switch cannot undo logout');

  view = await fresh(); await music(view).onOffline();
  let completeProbe;
  response = () => new Promise(resolve => { completeProbe = resolve; });
  const reconnectingView = render(); await tick();
  const completeReconnect = completeProbe;
  music(reconnectingView).onLogout();
  completeReconnect({ ok: true, status: 200 }); await tick();
  assert.equal(api.currentAccount(), null, 'pending reconnect cannot undo logout');
  effects.forEach(effect => effect?.cleanup?.());
  console.log('Connectivity: network classification, transient failures, automatic offline/reconnect, preserved provider/cache, account isolation and logout races passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
