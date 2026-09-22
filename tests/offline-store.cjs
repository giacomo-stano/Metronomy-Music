// Tests the actual TypeScript store with in-memory filesystem/network adapters.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const files = new Map(), persisted = new Map();
let account = { username: 'giacomo', baseURL: 'https://bridge.test', token: 'secret' };
let downloads = 0, status = 200, size = 4, cancelled = false, gate, free = 1e9;
const native = {
  documentDirectory: 'file:///documents/', FileSystemSessionType: { FOREGROUND: 0 },
  makeDirectoryAsync: async () => {},
  getFreeDiskStorageAsync: async () => free,
  getInfoAsync: async path => files.has(path) ? { exists: true, isDirectory: false, size: files.get(path) } : { exists: false },
  readDirectoryAsync: async root => [...files.keys()].filter(p => p.startsWith(root)).map(p => p.slice(root.length)),
  deleteAsync: async path => { assert(path.startsWith('file:///documents/metronomy-offline/')); files.delete(path); },
  moveAsync: async ({ from, to }) => { files.set(to, files.get(from)); files.delete(from); },
  createDownloadResumable: (url, path, options, progress) => {
    assert.equal(options.headers.Authorization, 'Bearer secret'); assert(!url.includes('secret'));
    let stopped = false;
    return {
      cancelAsync: async () => { stopped = true; cancelled = true; },
      downloadAsync: async () => {
        downloads++; progress?.({ totalBytesWritten: 2, totalBytesExpectedToWrite: 4 });
        if (gate) await gate;
        if (stopped) return;
        files.set(path, size); return { status, uri: path, headers: { 'content-type': url.includes('/cover/') ? 'image/jpeg' : 'audio/flac' } };
      },
    };
  },
};
const api = {
  currentAccount: () => account,
  accountStorageKey: () => 'metronomy.offline.v1:' + encodeURIComponent(account.baseURL) + ':' + encodeURIComponent(account.username),
  request: async path => path.startsWith('lyrics/') ? { lyrics: [{ synced: true, line: [{ start: 1000, value: 'Cached line' }] }], source: 'Test source' } : ({ song: { id: decodeURIComponent(path.split('/')[1]), title: 'Track', artist: 'Artist', albumId: 'album', artistId: 'artist', album: 'Album', duration: 30, ...(path.includes('/rich/') ? { coverArt: 'cover' } : {}) }, suffix: 'flac', size: 4, info: { genre: 'Test', suffix: 'flac' } }),
};
const storage = { getAllKeys: async () => [...persisted.keys()], getItem: async key => persisted.get(key) ?? null, setItem: async (key,value) => { persisted.set(key,value); } };
function load(name) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync('src/' + name + '.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(source, { exports, require: name => name === 'expo-file-system/legacy' ? native : name === './api' ? api : name.startsWith('./') ? load(name.slice(2)) : storage, console, Date, Math, Promise, Map, Set, URL, URLSearchParams });
  return exports;
}
const { OfflineStore } = load('offlineStore');
const song = id => ({ id, title: id, artist: 'Artist', duration: 30 });
async function until(condition) { for(let i=0;i<100;i++) { if(condition()) return; await new Promise(setImmediate); } throw Error('Timeout'); }
(async () => {
  let store = new OfflineStore(); await store.loading;
  await store.download(song('one')); assert(store.tracks.one); assert.equal(downloads, 1);
  await store.download(song('one')); assert.equal(downloads, 1, 'duplicate prevented');
  const uri = await store.source('one'); assert(uri.startsWith('file:///documents/'));
  assert(!JSON.stringify([...persisted.values()]).includes('secret'), 'no persisted token');
  await store.favorite('one', true); assert(store.tracks.one.song.starred);
  store.dispose(); store = new OfflineStore(); await store.loading; assert(store.tracks.one, 'survives restart');
  account = { ...account, username: 'lorenza' }; const other = new OfflineStore(); await other.loading;
  assert.equal(Object.keys(other.tracks).length, 0, 'account isolation');
  await other.remove('one'); assert(files.has(uri), 'cannot remove other account file'); other.dispose();
  account = store.account;
  status = 403; await store.download(song('denied')); assert(!store.tracks.denied); assert.equal(store.transfers.denied.state, 'error'); status = 200;
  size = 2; await store.download(song('partial')); assert(!store.tracks.partial); assert.equal(store.transfers.partial.state, 'error'); size = 4;
  let resume; gate = new Promise(r => resume = r);
  const running = store.download(song('cancel'));
  await until(() => downloads === 4); await store.cancel('cancel'); resume(); await running; gate = undefined;
  assert(cancelled); assert(!store.tracks.cancel); assert(!store.transfers.cancel);
  await store.remove('one'); assert(!files.has(uri)); assert(!store.tracks.one);
  await store.download(song('missing')); const missing = await store.source('missing'); files.delete(missing);
  assert.equal(await store.source('missing'), undefined); assert(!store.tracks.missing);
  assert([...files.keys()].every(p => !p.endsWith('.part')), 'no partial files left');
  const before = downloads;
  await Promise.all([store.download(song('double-tap')), store.download(song('double-tap'))]);
  assert.equal(downloads, before + 1, 'simultaneous duplicate prevented');
  free = 1; await store.download(song('no-space')); free = 1e9;
  assert(!store.tracks['no-space']); assert.equal(store.transfers['no-space'].state, 'error');
  gate = new Promise(r => resume = r);
  const active = store.download(song('logout'));
  await until(() => downloads === before + 2);
  store.dispose(); resume(); await active; gate = undefined;
  assert(!store.tracks.logout, 'logout cancels in-flight download');
  store.dispose(); store = new OfflineStore(); await store.loading;
  await store.download(song('rich')); assert(store.cover('cover').endsWith('.jpg'));
  assert.equal(store.tracks.rich.lyrics.lyrics[0].line[0].start, 1000);
  assert.equal(store.tracks.rich.info.genre, 'Test');
  const cover = store.cover('cover');
  const catalogVersion = store.librarySnapshot();
  const snapshot = store.snapshot();
  store.emit(true);
  assert.equal(store.librarySnapshot(), catalogVersion, 'download progress does not refresh whole library');
  assert.equal(store.snapshot(), snapshot + 1);
  assert.equal(store.cover('cover'), cover);
  store.dispose();
  const profiles = await load('offlineProfiles').offlineProfiles(); assert.equal(profiles.length, 1);
  account = load('offlineProfiles').offlineAccount(profiles[0]);
  assert.equal(account.token, ''); assert.equal(account.admin, false); assert.equal(account.offline, true);
  store = new OfflineStore(); await store.loading;
  assert.equal(store.cover('cover'), cover); assert(files.has(cover));
  const prior = downloads;
  assert.equal((await store.lyricsFor('rich')).lyrics[0].line[0].value, 'Cached line');
  assert((await store.read('library/songs')).songs.some(s => s.id === 'rich'));
  assert.equal((await store.read('albums/album')).songs.some(s => s.id === 'rich'), true);
  assert((await store.read('search?q=Track')).songs.length > 0);
  await assert.rejects(store.read('songs/rich/delete', {}), /online/);
  await assert.rejects(store.read('network/search?q=Track'), /online/);
  await assert.rejects(store.download(song('another')), /online/);
  assert.equal(downloads, prior, 'offline operations cannot use network');
  assert(!JSON.stringify([...persisted.values()]).includes('secret'));
  await store.remove('rich'); assert(!files.has(cover), 'cover removed with local song');
  assert.equal(store.cover('cover'), undefined, 'cover index invalidates after local removal');
  store.dispose(); console.log('Offline store: downloads, cancellation, isolation, cached covers/lyrics/metadata, profile discovery, offline catalog and write restrictions passed.');
})().catch(e => { console.error(e); process.exitCode = 1; });
