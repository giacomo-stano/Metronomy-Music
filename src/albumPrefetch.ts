import { currentAccount, request, type Song } from './api';

const cache = new Map<string, { songs: Song[]; expires: number }>();
const pending = new Map<string, Promise<Song[]>>();
const waiting: { id: string; run: () => void; reject: (error: Error) => void }[] = [];
let active = 0;
let generation = 0;
let owner = currentAccount();
function accountScope() {
  if (owner !== currentAccount()) { clearAlbumSongsCache(); owner = currentAccount(); }
}
function drain() {
  while (active < 3 && waiting.length) waiting.shift()!.run();
}
export function peekAlbumSongs(albumId: string): Song[] | undefined {
  accountScope();
  const entry = cache.get(albumId);
  if (!entry) return;
  cache.delete(albumId);
  if (entry.expires <= Date.now()) return;
  cache.set(albumId, entry);
  return entry.songs;
}
export function preloadAlbumSongs(albumId: string, force = false, priority = false): Promise<Song[]> {
  accountScope();
  if (!force) {
    const hit = peekAlbumSongs(albumId);
    if (hit) return Promise.resolve(hit);
    const existing = pending.get(albumId);
    if (existing) {
      const index = waiting.findIndex(task => task.id === albumId);
      if (priority && index > 0) waiting.unshift(waiting.splice(index, 1)[0]);
      return existing;
    }
  }
  const version = generation;
  const account = owner;
  const promise = new Promise<Song[]>((resolve, reject) => {
    const task = { id: albumId, reject, run: () => {
      active++;
      void request<{ songs: Song[] }>('albums/' + encodeURIComponent(albumId)).then(data => {
        if (version !== generation || account !== currentAccount()) throw new Error('Caricamento album superato. Riprova.');
        const songs = Array.isArray(data.songs) ? data.songs : [];
        cache.set(albumId, { songs, expires: Date.now() + 60000 });
        while (cache.size > 40) cache.delete(cache.keys().next().value!);
        resolve(songs);
      }).catch(reject).finally(() => { active--; drain(); });
    } };
    if (priority) waiting.unshift(task); else waiting.push(task);
    drain();
  }).finally(() => { if (pending.get(albumId) === promise) pending.delete(albumId); });
  pending.set(albumId, promise);
  return promise;
}
export function clearAlbumSongsCache() {
  generation++;
  cache.clear();
  pending.clear();
  for (const task of waiting.splice(0)) task.reject(new Error('Caricamento album annullato.'));
}
