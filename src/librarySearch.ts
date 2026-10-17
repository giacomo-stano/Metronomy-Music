import { libraryEndpoint, type LibraryOrder } from './libraryList';

export function supportsRemoteLibrarySearch(endpoint: string, type: string) {
  return endpoint === 'library/songs' || (type === 'albums' && endpoint.startsWith('albums?'));
}

export function librarySearchEndpoint(endpoint: string, type: string, order: LibraryOrder, query: string, offline: boolean) {
  const q = query.trim();
  if (!offline && q && supportsRemoteLibrarySearch(endpoint, type)) {
    return 'library/search?kind=' + (type === 'albums' ? 'albums' : 'songs') + '&q=' + encodeURIComponent(q);
  }
  return libraryEndpoint(endpoint, type, order);
}

type Searchable = { title?: string; name?: string; artist?: string; album?: string };
const normalize = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
// Complete collections only: favorites, artists, playlists and on-device songs.
// Never use this as a substitute for searching unloaded server pages.
export function filterLibraryItems<T extends Searchable>(items: T[], query: string): T[] {
  const words = normalize(query.trim()).split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  return items.filter(item => {
    const text = normalize([item.title, item.name, item.artist, item.album].filter(Boolean).join(' '));
    return words.every(word => text.includes(word));
  });
}
