const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
function load(name) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/' + name + '.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: path => load(path.slice(2)), URLSearchParams, Date });
  return exports;
}
const { supportsRemoteLibrarySearch, librarySearchEndpoint, filterLibraryItems } = load('librarySearch');
const ids = rows => Array.from(rows, item => item.id);
for (const [path, type, kind] of [
  ['library/songs', 'songs', 'songs'],
  ['albums?sort=alphabeticalByName', 'albums', 'albums'],
]) {
  assert(supportsRemoteLibrarySearch(path, type));
  assert.equal(librarySearchEndpoint(path, type, 'title', '  Neffa & friends  ', false),
    'library/search?kind=' + kind + '&q=Neffa%20%26%20friends');
  assert(!librarySearchEndpoint(path, type, 'title', 'Neffa', true).startsWith('library/search'),
    'offline searches must stay inside the downloaded catalog');
  assert(!librarySearchEndpoint(path, type, 'title', '   ', false).startsWith('library/search'));
}
for (const [path, type] of [
  ['library/artists', 'artists'], ['library/playlists', 'playlists'],
  ['library/playlists/one', 'songs'], ['library/favorites', 'favorites'],
  ['', 'downloads'], ['albums?sort=newest', 'home'],
]) assert(!supportsRemoteLibrarySearch(path, type), 'search complete scoped collections locally');
const items = [
  { id: '1', title: 'Città', artist: 'Neffa', album: 'Album' },
  { id: '2', title: 'Other', artist: 'Someone' },
  { id: '3', name: 'Playlist di Neffa' },
];
assert.deepEqual(ids(filterLibraryItems(items, 'CITTA neffa')), ['1']);
assert.deepEqual(ids(filterLibraryItems(items, ' neffa   album ')), ['1']);
assert.deepEqual(ids(filterLibraryItems(items, 'NEFFA')), ['1', '3']);
assert.deepEqual(ids(filterLibraryItems(items, 'missing')), []);
assert.equal(filterLibraryItems(items, '   '), items, 'empty filter preserves collection identity');
assert.deepEqual(ids(items), ['1', '2', '3'], 'filter never mutates shared cache');
// Rendered search must not re-key/remount the list/TextInput on every character.
const source = fs.readFileSync('src/LibraryScreen.tsx', 'utf8');
const ast = ts.createSourceFile('LibraryScreen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let listKey;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'listKey') listKey = node.initializer.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert(listKey && !/search|query/i.test(listKey));
assert(source.includes('keyboardShouldPersistTaps="handled"'));
assert(source.includes('keyboardDismissMode="on-drag"'));
assert(source.includes('settledSearch.key !== searchKey'));
assert(source.includes('loadedKey !== requestKey'), 'old search results must not flash as a new query resolves');
assert(source.includes('Cerca in ') && source.includes('Cancella ricerca'));
console.log('Library search: scoped remote pagination, offline/local filtering, accents, stable input and stale result guards passed.');
