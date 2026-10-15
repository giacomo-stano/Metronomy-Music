import type { Song } from './api';

export type LibraryOrder = 'newest' | 'oldest' | 'title' | 'artist';

export function libraryEndpoint(endpoint: string, type: string, order: LibraryOrder) {
  if (endpoint === 'library/songs' || endpoint === 'library/favorites') {
    return endpoint + '?sort=' + order;
  }
  if (type === 'albums' && endpoint.startsWith('albums?')) {
    return 'albums?sort=' + (order === 'artist' ? 'alphabeticalByArtist' : 'alphabeticalByName');
  }
  return endpoint;
}

// Used for complete local/offline collections only. Paginated online lists keep
// the server order so newly appended pages never rearrange existing rows.
export function orderLocalSongs(songs: Song[], order: LibraryOrder, savedAt?: Record<string, number>) {
  return [...songs].sort((a, b) => {
    const title = () => a.title.localeCompare(b.title, 'it', { sensitivity: 'base' }) || a.id.localeCompare(b.id);
    if (order === 'title') return title();
    if (order === 'artist') return a.artist.localeCompare(b.artist, 'it', { sensitivity: 'base' }) || title();
    const time = (s: Song) => savedAt ? savedAt[s.id] : Date.parse(s.created ?? '');
    const left = time(a), right = time(b);
    const hasLeft = Number.isFinite(left), hasRight = Number.isFinite(right);
    if (hasLeft !== hasRight) return hasLeft ? -1 : 1;
    return (hasLeft && hasRight ? (left - right) * (order === 'newest' ? -1 : 1) : 0) || title();
  });
}

export function mergeLibraryItems<T extends { id: string }>(old: T[], incoming: T[]): T[] {
  const seen = new Set(old.map(item => item.id));
  return [...old, ...incoming.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id); return true;
  })];
}

export function nextLibraryPage(offset: number, count: number, nextOffset?: number, hasMore?: boolean) {
  const next = nextOffset ?? offset + count;
  return { nextOffset: next, hasMore: !!hasMore && count > 0 && Number.isInteger(next) && next > offset };
}
