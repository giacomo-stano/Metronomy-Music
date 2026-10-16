const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
function load(name) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/' + name + '.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, Map, Date });
  return exports;
}
const { collectLibrarySongs } = load('libraryDownload');
const { TabPressTracker } = load('tabNavigation');
(async () => {
  const songs = Array.from({ length: 205 }, (_, i) => ({ id: String(i), title: String(i) }));
  const calls = [], counts = [];
  const result = await collectLibrarySongs(async path => {
    const offset = Number(new URL('https://test/' + path).searchParams.get('offset')); calls.push(offset);
    return { songs: songs.slice(offset, offset + 100), nextOffset: offset + 100, hasMore: offset + 100 < songs.length };
  }, () => true, n => counts.push(n));
  assert.deepEqual(calls, [0, 100, 200]); assert.equal(result.length, 205); assert.deepEqual(counts, [100, 200, 205]);
  let count = 0;
  assert.equal((await collectLibrarySongs(async () => ({ songs: [songs[0]], hasMore: count++ === 0, nextOffset: 1 }), () => true, () => {})).length, 1, 'boundary duplicates are not downloaded twice');
  await assert.rejects(collectLibrarySongs(async () => ({ songs: [songs[0]], hasMore: true, nextOffset: 0 }), () => true, () => {}), /lista/);
  await assert.rejects(collectLibrarySongs(async () => ({ songs: null }), () => true, () => {}), /non valida/);
  await assert.rejects(collectLibrarySongs(async () => ({ songs: [{ id: 'q', qobuzId: '1' }] }), () => true, () => {}), /non valida/);
  let alive = true;
  assert.equal((await collectLibrarySongs(async () => { alive = false; return { songs }; }, () => alive, () => { throw Error('stale progress'); })).length, 0);
  for (const tab of ['Home', 'Novità', 'Libreria', 'Cerca']) {
    const taps = new TabPressTracker();
    assert.equal(taps.press(tab, 1000), false, 'single tap restores last page immediately');
    assert.equal(taps.press(tab, 1250), true, 'double tap resets this tab');
    assert.equal(taps.press(tab, 1300), false, 'third tap starts a new pair');
    assert.equal(taps.press(tab, 2000), false, 'slow repeated taps do not reset');
    assert.equal(taps.press(tab, 2100, false), false, 'drag or long press does not reset');
    assert.equal(taps.press(tab, 2150), false, 'drag breaks a double tap');
  }
  const taps = new TabPressTracker();
  assert.equal(taps.press('Cerca', 1000), false); assert.equal(taps.press('Libreria', 1100), false); assert.equal(taps.press('Cerca', 1200), false);
  const app = fs.readFileSync('App.tsx', 'utf8');
  const ast = ts.createSourceFile('App.tsx', app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let selectSource;
  function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === 'selectTab') selectSource = node.getText(ast); ts.forEachChild(node, visit); }
  visit(ast); assert(selectSource);
  const history = { current: {} }, resets = { Home: 0, 'Novità': 0, Libreria: 0, Cerca: 0 };
  const a = { id: 'a' }, b = { id: 'b' };
  const nav = {
    exports: {}, tab: 'Home', album: a, albumSongs: ['a1'], albumScrollY: { current: 240 },
    tabAlbums: history, generation: { current: 0 }, restoringAlbum: { current: false },
    albumOpenAnimation: { current: { stop() {} } }, albumCloseAnimation: { current: { stop() {} } }, albumOpenFrame: { current: null },
    rootLists: { current: { Home: { scrollToOffset: p => assert.equal(p.offset, 0) } } },
    setTabResets: fn => Object.assign(resets, fn(resets)),
    setTab: value => nav.tab = value, setAlbum: value => nav.album = value, setAlbumSongs: value => nav.albumSongs = value,
    setAlbumInitialOffset: value => nav.offset = value, setAlbumOrigin() {}, setActionSong() {}, setActionAlbum() {}, setError() {}, setBusy() {},
    setQuery: value => nav.query = value,
  };
  vm.runInNewContext(ts.transpileModule(selectSource + '\nexports.selectTab = selectTab;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, nav);
  nav.exports.selectTab('Libreria'); assert.equal(nav.album, null); assert.equal(history.current.Home.album, a);
  nav.album = b; nav.albumSongs = ['b1']; nav.albumScrollY.current = 680;
  nav.exports.selectTab('Home'); assert.equal(nav.album, a); assert.equal(nav.offset.y, 240); assert.equal(nav.restoringAlbum.current, true);
  const initialOffset = nav.offset;
  nav.exports.selectTab('Home'); assert.equal(nav.offset, initialOffset, 'one tap on current tab does not reset its offset');
  nav.exports.selectTab('Home', true); assert.equal(nav.album, null); assert.equal(resets.Home, 1); assert.equal(resets.Libreria, 0);
  nav.exports.selectTab('Libreria'); assert.equal(nav.album, b); assert.equal(nav.offset.y, 680, 'resetting Home preserves Library album');
  nav.query = 'artist'; nav.exports.selectTab('Cerca', true); assert.equal(nav.query, ''); assert.equal(resets.Cerca, 1);
  nav.exports.selectTab('Home', true);
  const pendingGeneration = nav.generation.current;
  nav.exports.selectTab('Home', true);
  assert.equal(nav.generation.current, pendingGeneration, 'reset of an open root keeps its pending data load valid');
  assert(app.includes('change.current = onChange'), 'PanResponder must use the latest state callback');
  assert(app.includes('tabAlbums.current[tab] = { album, songs: albumSongs, y: albumScrollY.current }'), 'album and offset retained per tab');
  assert(app.includes('contentOffset={albumInitialOffset}'));
  assert(app.includes('resetKey={tabResets.Libreria}') && app.includes('resetKey={tabResets.Cerca}'));
  assert(!app.includes('key={tabResets.'), 'single tab selection must not remount screens');
  const menu = fs.readFileSync('src/LibraryDownloadActions.tsx', 'utf8');
  // Exercise the actual ellipsis handler AND its conditional menu content.
  // The actions existed previously but were unreachable because Songs opened sort.
  const librarySource = fs.readFileSync('src/LibraryScreen.tsx', 'utf8');
  const libraryAst = ts.createSourceFile('LibraryScreen.tsx', librarySource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let pageHandler, pageContent;
  function visitLibrary(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'openPageMenu') pageHandler = node.getText(libraryAst);
    if (ts.isJsxExpression(node) && node.expression?.getText(libraryAst).startsWith('pageMenu &&')) pageContent = node.expression.getText(libraryAst);
    ts.forEachChild(node, visitLibrary);
  }
  visitLibrary(libraryAst); assert(pageHandler && pageContent);
  assert(librarySource.includes('onPress={openPageMenu}'));
  const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'Fragment' };
  const code = ts.transpileModule(pageHandler + '\nexports.openPageMenu = openPageMenu; exports.render = () => (' + pageContent + ');', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  for (const [type, endpoint, expected] of [['songs', 'library/songs', true], ['downloads', '', true], ['favorites', 'library/favorites', false], ['albums', 'albums', false]]) {
    const context = {
      exports: {}, require: () => jsx, songPage: type !== 'albums', collectionPage: type === 'albums', page: { type, endpoint }, pageMenu: false,
      openTopMenu: kind => { context.opened = kind; context.pageMenu = kind === 'page'; },
      LibraryDownloadActions: 'LibraryDownloadActions', View: 'View', topStyles: {}, c: {}, p: { onRemoveLocal() {} },
      closeTopMenu() {}, pageActionRow: () => null,
    };
    vm.runInNewContext(code, context); context.exports.openPageMenu();
    assert.equal(context.opened, 'page', type + ' ellipsis opens page actions, not sort');
    const rendered = JSON.stringify(context.exports.render());
    assert.equal(rendered.includes('LibraryDownloadActions'), expected, type + ' exposes the correct local actions');
  }
  assert(menu.includes('style: \'destructive\'') && menu.includes('store.removeAll(beforeRemove)'));
  assert(!menu.includes('/delete') && !menu.includes('/trash'), 'local menu cannot invoke server deletion');
  console.log('Bulk library pagination and tab gestures: all pages, duplicate IDs, cancellation, malformed pages, single/double taps and drag separation passed.');
})().catch(e => { console.error(e); process.exitCode = 1; });
