const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
function load(file, modules = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: name => { if (!(name in modules)) throw Error(name); return modules[name]; }, Date, Map, Set, Promise });
  return exports;
}
(async () => {
  const { catalogSong, mergeCatalog } = load('src/networkCatalog.ts');
  const track = { kind: 'track', id: '1', title: 'Title', artist: 'Artist', album: 'Album', duration: 123, cover: 'https://images.test/a.jpg', available: true };
  const song = catalogSong(track);
  assert.equal(song.id, 'qobuz:1'); assert.equal(song.duration, 123); assert(!song.albumId);
  const combined = mergeCatalog({ items: [track], libraryChecked: true }, { items: [track, { ...track, kind: 'artist' }], libraryChecked: false, nextOffset: 24 });
  assert.equal(combined.items.length, 2); assert.equal(combined.nextOffset, 24); assert.equal(combined.libraryChecked, false);

  const calls = [];
  let result = { url: 'https://cdn.test/current' };
  const { songPlaybackSource } = load('src/songPlaybackSource.ts', {
    './api': { request: async path => { calls.push(path); return result; }, streamURL: id => '/stream/' + id },
    './playbackSource': { playbackSource: async (id, offline, local, remote) => ({ uri: await local(id) || remote(id) }) },
  });
  const local = async () => 'file:///local.flac';
  assert.equal((await songPlaybackSource({ id: 'local' }, false, local)).uri, 'file:///local.flac');
  assert.equal(calls.length, 0);
  await assert.rejects(songPlaybackSource(song, true, local), /internet/); assert.equal(calls.length, 0);
  assert.equal((await songPlaybackSource(song, false, local)).uri, result.url);
  result = { url: 'https://cdn.test/refreshed' };
  assert.equal((await songPlaybackSource(song, false, local)).uri, result.url);
  assert.equal(calls.length, 2, 'fresh signed stream per start');
  result = { url: 'http://invalid.test/' };
  await assert.rejects(songPlaybackSource(song, false, local), /non valida/);

  const values = new Map(); let account = 'giacomo';
  const history = load('src/listeningProfile.ts', {
    '@react-native-async-storage/async-storage': { getItem: async key => values.get(key), setItem: async (key, value) => values.set(key, value) },
    './api': { accountStorageKey: key => account + ':' + key }, './react': {},
    react: { useSyncExternalStore: () => 0 },
  });
  history.rememberTrack('a'); history.rememberTrack('a'); history.rememberTrack('b');
  let seeds = await history.listeningSeeds(); assert.equal(seeds[0].id, 'a'); assert.equal(seeds[0].plays, 2);
  history.rememberTrack('c'); account = 'lorenza'; history.rememberTrack('x');
  seeds = await history.listeningSeeds(); assert.equal(seeds.length, 1); assert.equal(seeds[0].id, 'x');
  account = 'giacomo'; assert((await history.listeningSeeds()).some(s => s.id === 'c'), 'pending writes keep their original account');
  for (let i = 0; i < 150; i++) history.rememberTrack('t' + i);
  assert.equal((await history.listeningSeeds()).length, 12);
  assert.equal(JSON.parse(values.get('giacomo:taste.v1')).length, 100);
  const screen = fs.readFileSync('src/SearchScreen.tsx', 'utf8');
  assert(!screen.includes('network/preview') && !screen.includes('useAudioPlayer') && !screen.includes('setKind'), 'no preview player or manual kind selection');
  assert(screen.includes('local?.artists.map') && screen.includes('mergeCatalog'));
  const menu = fs.readFileSync('src/NetworkActions.tsx', 'utf8');
  assert(menu.includes('Scarica sul server') && menu.includes('network/downloads'));
  console.log('Network search: typed mixed results, pagination, full-player sources, offline rejection, expiring URLs, private bounded listening history and menu/search wiring passed.');
})().catch(e => { console.error(e); process.exitCode = 1; });
