const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, modules = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: name => { if (!(name in modules)) throw Error(name); return modules[name]; }, Map, Set, Promise });
  return exports;
}
(async () => {
  const catalog = load('src/networkCatalog.ts');
  const { catalogQueue, albumTracks } = load('src/catalogPlayback.ts', { './networkCatalog': catalog });
  const track = { id: '1', kind: 'track', title: 'A song', artist: 'Neffa', album: 'Album', available: true };
  const artist = { ...track, kind: 'artist', title: 'Neffa' };
  const album = { ...track, kind: 'album' };
  const sorted = catalog.searchItems([track, { ...track, id: '2' }, album, artist], ' neffà ');
  assert.equal(sorted[0].kind, 'artist');
  assert.equal(sorted[2].kind, 'album');
  assert.equal(sorted.length, 4);
  const calls = [];
  const queue = await catalogQueue([track, { ...track, id: '2', libraryMatch: 'local' }, { ...track, id: '3', available: false }], async path => {
    calls.push(path); return { song: { id: 'local', title: 'Local copy' } };
  });
  assert.equal(queue.length, 2); assert.equal(queue[0].id, 'qobuz:1'); assert.equal(queue[1].id, 'local');
  assert.equal(calls[0], 'songs/local');
  await assert.rejects(catalogQueue([{ ...track, available: false }], async () => {}), /Nessun brano/);
  await assert.rejects(catalogQueue([{ ...track, libraryMatch: 'private' }], async () => { throw Error('403'); }), /403/);
  assert.equal((await catalogQueue([track], async () => {}, () => false)).length, 0);
  const pages = [];
  const tracks = await albumTracks('abc', async path => {
    pages.push(path);
    return path.includes('?') ? { items: [{ ...track, id: '2' }], hasMore: false, libraryChecked: true }
      : { items: [track], hasMore: true, nextOffset: 100, libraryChecked: true };
  });
  assert.equal(tracks.length, 2); assert.equal(pages[1], 'network/album/abc?offset=100');
  await assert.rejects(albumTracks('abc', async () => ({ items: [track], hasMore: true, nextOffset: 100 })), /paginazione/);
  let valid = true, count = 0;
  assert.equal((await albumTracks('abc', async () => { count++; valid = false; return { items: [track], hasMore: true, nextOffset: 100 }; }, () => valid)).length, 0);
  assert.equal(count, 1);
  const screen = fs.readFileSync('src/CatalogBrowser.tsx', 'utf8');
  assert(screen.includes('useNativeDriver: true') && screen.includes('reduceMotion'));
  assert(screen.includes("accountStorageKey('catalog-artist:'"));
  assert(screen.includes('NetworkActions') && screen.includes('activeRef.current'));
  assert(!screen.includes('network/downloads'), 'only an explicit menu action downloads');
  assert(fs.readFileSync('App.tsx', 'utf8').includes('onPlayQueue={songs => start(songs, 0, false)}'));
  console.log('Artist catalog: mixed ranking, full album pagination, local identity, unavailable filtering, cancellation and menu wiring passed.');
})().catch(e => { console.error(e); process.exitCode = 1; });
