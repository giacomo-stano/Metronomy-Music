const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(name) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/' + name + '.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: name => load(name.slice(2)), URLSearchParams, Date, Set });
  return exports;
}
const helpers = load('libraryList'), { localCatalog } = load('localCatalog');
const { libraryEndpoint, orderLocalSongs, mergeLibraryItems, nextLibraryPage } = helpers;
const ids = items => Array.from(items, s => s.id);
const rows = [
  { id: 'a', title: 'Alpha', artist: 'Z', duration: 10, created: '2026-10-01T00:00:00Z', starred: true },
  { id: 'z', title: 'Zulu', artist: 'A', duration: 10, created: '2026-10-15T00:00:00Z', starred: true },
  { id: 'u', title: 'Unknown', artist: 'B', duration: 10 },
];
assert.equal(libraryEndpoint('library/songs', 'songs', 'oldest'), 'library/songs?sort=oldest');
assert.equal(libraryEndpoint('library/favorites', 'favorites', 'title'), 'library/favorites?sort=title');
assert.equal(libraryEndpoint('library/playlists/one', 'songs', 'artist'), 'library/playlists/one');
assert.equal(libraryEndpoint('albums?sort=newest', 'home', 'newest'), 'albums?sort=newest');
assert.equal(libraryEndpoint('albums?sort=alphabeticalByName', 'albums', 'artist'), 'albums?sort=alphabeticalByArtist');
assert.deepEqual(ids(orderLocalSongs(rows, 'newest')), ['z', 'a', 'u']);
assert.deepEqual(ids(orderLocalSongs(rows, 'oldest')), ['a', 'z', 'u']);
assert.deepEqual(ids(orderLocalSongs(rows, 'title')), ['a', 'u', 'z']);
assert.deepEqual(ids(orderLocalSongs(rows, 'artist')), ['z', 'u', 'a']);
assert.deepEqual(ids(orderLocalSongs(rows, 'newest', { a: 30, z: 20, u: 10 })), ['a', 'z', 'u'], 'Downloads use iPhone savedAt');
assert.deepEqual(ids(rows), ['a', 'z', 'u']);
const local = rows.map((song, i) => ({ song, savedAt: i + 1 }));
assert.deepEqual(ids(localCatalog(local, 'library/songs?sort=oldest').songs), ['u', 'a', 'z']);
assert.deepEqual(ids(localCatalog(local, 'library/favorites?sort=newest').songs), ['z', 'a']);
assert.deepEqual(ids(mergeLibraryItems([rows[0]], [rows[0], rows[1], rows[1]])), ['a', 'z']);
assert.equal(nextLibraryPage(100, 5, 105, false).hasMore, false);
assert.equal(nextLibraryPage(100, 0, 100, true).hasMore, false);
assert.equal(nextLibraryPage(100, 10, 100, true).hasMore, false);
assert.equal(nextLibraryPage(100, 10, undefined, true).nextOffset, 110);

// Execute the real screen pagination handler, including its concurrent-request
// and generation guards, without replacing its logic with a test implementation.
const source = fs.readFileSync('src/LibraryScreen.tsx', 'utf8');
const ast = ts.createSourceFile('LibraryScreen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let more;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'more') more = node.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast); assert(more);
const compiled = ts.transpileModule(more, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function harness() {
  let resolve, reject, calls = [];
  const context = {
    ...helpers, p: { active: true }, busy: false, moreBusy: false, moreError: '',
    loadingMore: { current: false }, requestedOffsets: { current: new Set() }, failedOffset: { current: null },
    generation: { current: 1 }, loadedKey: 'songs:newest', requestKey: 'songs:newest',
    data: { songs: [rows[0]], hasMore: true, nextOffset: 100 }, grid: false,
    albums: [], songs: [rows[0]], page: { type: 'songs' }, endpoint: 'library/songs?sort=newest',
    isConnectivityFailure: () => false, Error,
    setMoreBusy: value => { context.moreBusy = value; },
    setMoreError: value => { context.moreError = value; },
    setData: value => { context.data = value(context.data); context.songs = context.data.songs; },
    request: path => { calls.push(path); return new Promise((yes, no) => { resolve = yes; reject = no; }); },
  };
  vm.createContext(context); vm.runInContext(compiled, context);
  return { context, calls, finish: value => resolve(value), fail: value => reject(value), more: retry => context.more(retry) };
}
(async () => {
  const h = harness();
  const first = h.more(); await h.more();
  assert.equal(h.calls.length, 1, 'repeated end events share one in-flight page');
  assert.equal(h.calls[0], 'library/songs?sort=newest&offset=100');
  assert.equal(h.context.busy, false, 'pagination must not start pull-to-refresh');
  assert.equal(h.context.moreBusy, true);
  h.finish({ songs: [rows[0], rows[1], rows[1]], hasMore: true, nextOffset: 103 });
  await first;
  assert.deepEqual(ids(h.context.data.songs), ['a', 'z']);
  assert.equal(h.context.data.nextOffset, 103, 'advance by raw server offset, not deduplicated size');
  const last = h.more(); h.finish({ songs: [rows[2]], hasMore: false, nextOffset: 104 }); await last;
  await h.more(); assert.equal(h.calls.length, 2, 'terminal page stops requests');
  assert.deepEqual(ids(h.context.data.songs), ['a', 'z', 'u']);

  const failed = harness(); const request = failed.more(); failed.fail(Error('Network')); await request;
  await failed.more(); assert.equal(failed.calls.length, 1, 'no automatic retry storm');
  failed.context.moreError = '';
  await failed.more(); assert.equal(failed.calls.length, 1, 'the synchronous error ref guards stale render handlers too');
  assert.equal(failed.context.data.songs.length, 1, 'failed pages preserve displayed rows');
  const retry = failed.more(true); failed.finish({ songs: [rows[1]], hasMore: false }); await retry;
  assert.equal(failed.calls.length, 2); assert.equal(failed.context.moreError, '');

  for (const change of ['sort', 'refresh', 'tab', 'logout']) {
    const stale = harness(), pending = stale.more();
    stale.context.generation.current++; // the effect cleanup invalidates requests
    stale.context.data = { songs: [rows[2]], hasMore: false };
    stale.finish({ songs: [rows[1]], hasMore: true, nextOffset: 200 }); await pending;
    assert.deepEqual(ids(stale.context.data.songs), ['u'], 'late page ignored after ' + change);
  }
  for (const mutate of [
    c => { c.p.active = false; }, c => { c.busy = true; },
    c => { c.loadedKey = 'previous sort'; }, c => { c.data.hasMore = false; },
    c => { c.requestedOffsets.current.add(100); },
    c => { c.failedOffset.current = 100; },
  ]) {
    const blocked = harness(); mutate(blocked.context); await blocked.more();
    assert.equal(blocked.calls.length, 0);
  }
  const empty = harness(), pending = empty.more();
  empty.finish({ songs: [], hasMore: true }); await pending; await empty.more();
  assert.equal(empty.calls.length, 1, 'empty broken upstream response cannot loop');
  assert(source.includes('onEndReached={() => void more()}'));
  assert(!source.includes('Carica altri'));
  assert(source.includes('cache.get(endpoint, () => request<Data>(endpoint'));
  assert(source.includes('cache.set(endpoint, next)'));
  assert(source.includes('key={listKey'));
  assert(source.includes('refreshing={busy &&'));
  console.log('Library: global request ordering, offline dates, infinite scroll, deduplication, retry, stale responses and refresh isolation passed.');
})().catch(e => { console.error(e); process.exitCode = 1; });
