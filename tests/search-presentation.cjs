const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, modules = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, { exports, require: name => { assert(name in modules, name); return modules[name]; }, console, Map, Set, Promise, ...globals });
  return exports;
}
const motion = load('src/searchMotion.ts');
for (const [offset, editing, height] of [[0, 0, 62], [-40, 0, 62], [31, 0, 31], [999, 0, 0], [0, 1, 0], [0, 0.5, 31], [31, 0.5, 15.5]]) {
  assert.equal(motion.searchTitleHeight(offset, editing), height);
}
const history = load('src/searchHistory.ts');
const entry = { query: 'Neffa', title: 'Neffa', kind: 'artist', scope: 'qobuz', cover: 'https://images.test/artist.jpg', token: 'private', url: 'https://signed.test/play' };
const values = history.readSearchHistory(['Old query', entry, null, { query: 'bad' }]);
assert.equal(values.length, 2);
assert.equal(values[1].token, undefined); assert.equal(values[1].url, undefined);
for (const cover of ['https://user:secret@host/img', 'https://host/img?token=secret', 'http://host/img', 'file:///private/img']) {
  assert.equal(history.readSearchHistory([{ ...entry, cover }])[0].cover, undefined);
}
const both = history.addSearchHistory(values, { ...entry, scope: 'library' });
assert.equal(both.length, 3, 'same artist in two sources stays distinct');
assert.equal(history.addSearchHistory(both, { ...entry, query: 'NEFFA' }).length, 3);
assert.equal(history.readSearchHistory(Array.from({ length: 30 }, (_, i) => 'query' + i)).length, 10);

// Execute the real SearchScreen state/effects and drive its actual scaffold props.
// In particular, keyboard blur must NOT exit the search presentation or lose its query.
let hooks = [], cursor = 0, effects = [], dirty = false, timers = new Map(), serial = 0;
const slot = initial => { const n = cursor++; return hooks[n] ?? (hooks[n] = initial()); };
const react = {
  useState: initial => { const s = slot(() => ({ value: typeof initial === 'function' ? initial() : initial }));
    return [s.value, update => { const next = typeof update === 'function' ? update(s.value) : update; if (!Object.is(next, s.value)) { s.value = next; dirty = true; } }]; },
  useRef: initial => slot(() => ({ current: initial })),
  useEffect: (fn, deps) => { const s = slot(() => ({ deps: null, cleanup: null }));
    if (!s.deps || deps.some((d, i) => !Object.is(d, s.deps[i]))) { effects.push(() => { s.cleanup?.(); s.cleanup = fn(); }); s.deps = deps; } },
};
const jsx = { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }), Fragment: 'Fragment' };
const requests = [], writes = [];
const catalog = load('src/networkCatalog.ts');
const modules = {
  react, 'react/jsx-runtime': jsx,
  'react-native': { ActivityIndicator: 'Spinner', Alert: { alert() {} }, Image: 'Image', Keyboard: { dismiss() {} }, Text: 'Text', TextInput: 'Input', View: 'View' },
  '@expo/vector-icons': { Ionicons: 'Icon' },
  '@react-native-async-storage/async-storage': { getItem: async () => '[]', setItem: async (key, value) => writes.push([key, value]) },
  './api': { accountStorageKey: () => 'current-account:searches', coverURL: value => value, isConnectivityFailure: () => false,
    request: async path => { requests.push(path); return path.startsWith('network') ? { items: [], hasMore: false } : { songs: [], albums: [], artists: [] }; } },
  './theme': { useTheme: () => ({ colors: {} }) },
  './SearchScaffold': { default: 'Scaffold', __esModule: true },
  './searchHistory': history, './networkCatalog': catalog, './ScreenCache': load('src/ScreenCache.ts'),
  './OfflineDownloads': { DownloadBadge: 'DownloadBadge' },
  './catalogPlayback': {}, './ServerDownloads': { useServerDownloads: () => ({ jobs: [] }) },
};
for (const name of ['SpringPressable', 'Discover', 'CatalogSearchResults', 'CatalogBrowser', 'NetworkActions']) modules['./' + name] = { __esModule: true, default: name };
const screen = load('src/SearchScreen.tsx', modules, {
  setTimeout: fn => { const id = ++serial; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id),
});
const props = { active: true, resetKey: 0, revision: 0, offline: false, initialQuery: '',
  onDetailChange() {}, onSettings() {}, onPlay() {}, onPlayQueue() {}, onAlbum() {}, onAlbumActions() {}, onActions() {}, onScroll() {} };
function find(node, type) {
  if (!node || typeof node !== 'object') return;
  if (node.type === type) return node;
  for (const child of [node.props?.children].flat(Infinity)) { const result = find(child, type); if (result) return result; }
}
function render() {
  let result, loops = 0;
  do { dirty = false; cursor = 0; result = screen.default(props); const pending = effects; effects = []; pending.forEach(f => f()); assert(++loops < 20, 'effect loop'); } while (dirty);
  return find(result, 'Scaffold').props;
}
async function settle() { for (const fn of [...timers.values()]) { timers.clear(); await fn(); } await Promise.resolve(); await Promise.resolve(); return render(); }
(async () => {
  let ui = render(); assert.equal(ui.searching, false);
  ui.onFocus(); ui = render(); assert.equal(ui.searching, true);
  ui.onChange('Neffa'); ui = await settle();
  // First render schedules the debounce after query changes.
  ui = await settle();
  ui.onBlur(); ui = render(); assert.equal(ui.searching, true); assert.equal(ui.query, 'Neffa');
  const before = requests.length; ui.onScope('qobuz'); ui = await settle();
  assert.equal(requests.length, before, 'reselecting source must not invalidate/clear results');
  ui.onScope('library'); ui = render(); ui = await settle(); assert.equal(ui.scope, 'library'); assert.equal(ui.query, 'Neffa');
  assert(requests.includes('search?q=Neffa'));
  ui.onClose(); ui = render(); assert.equal(ui.query, ''); assert.equal(ui.searching, false);
  ui.onFocus(); ui = render(); ui.onChange('Other'); ui = render(); props.resetKey++; ui = render();
  assert.equal(ui.searching, false); assert.equal(ui.query, '');
  props.offline = true; ui = render(); assert.equal(ui.scope, 'library');
  ui.onScope('qobuz'); ui = render(); assert.equal(ui.scope, 'library', 'offline never switches to Qobuz');
  const chrome = fs.readFileSync('src/SearchScaffold.tsx', 'utf8');
  assert(chrome.includes('useAnimatedScrollHandler') && chrome.includes('useAnimatedStyle'));
  assert(chrome.includes('automaticallyAdjustKeyboardInsets') && chrome.includes('keyboardDismissMode="interactive"'));
  assert(chrome.includes('reduceMotion ? 0') && chrome.includes('accessibilityElementsHidden'));
  assert(chrome.includes("'Qobuz' : 'Libreria'"));
  console.log('Search presentation: collapse geometry, focus/blur/close, source reselection, offline guard, history migration/privacy and native-thread animation wiring passed.');
})().catch(e => { console.error(e); process.exitCode = 1; });
