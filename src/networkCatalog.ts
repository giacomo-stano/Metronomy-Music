import type { Song } from './api';
export type CatalogItem = { id: string; kind: 'track' | 'album' | 'artist'; title: string; artist: string; album: string; albumId?: string | null; duration?: number; genre?: string; cover?: string; available: boolean; libraryMatch?: string | null; librarySong?: Song; libraryComplete?: boolean; libraryPresentCount?: number; libraryTotalCount?: number; releaseDate?: string; trackCount?: number; artistId?: string | null; explicit?: boolean };
export type Catalog = { items: CatalogItem[]; hasMore: boolean; nextOffset?: number; libraryChecked: boolean; title?: string; personalized?: boolean; genres?: string[]; album?: CatalogItem };
export type ArtistProfile = {
  artist: CatalogItem & { biography: string; biographySource: string };
  topTracks: CatalogItem[]; latestRelease: CatalogItem | null; principalAlbums: CatalogItem[];
  releases: { id: string; title: string; items: CatalogItem[] }[];
  similarArtists: CatalogItem[]; albums: Catalog; libraryChecked: boolean; partial: string[];
};

export function searchItems(items: CatalogItem[], query: string): CatalogItem[] {
  const key = (s: string) => s.trim().toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const q = key(query);
  const exactArtists = items.filter(i => i.kind === 'artist' && key(i.title) === q);
  const remaining = items.filter(i => !exactArtists.includes(i));
  // Interleave the provider's ranked groups instead of burying artists below 24 results.
  const groups = ['track', 'album', 'artist'].map(kind => remaining.filter(i => i.kind === kind));
  return [...exactArtists, ...Array.from({ length: Math.max(0, ...groups.map(g => g.length)) }, (_, n) => groups.flatMap(g => g[n] ? [g[n]] : [])).flat()];
}
export function catalogSong(item: CatalogItem): Song {
  return { id: 'qobuz:' + item.id, qobuzId: item.id, title: item.title, artist: item.artist,
    album: item.album, qobuzAlbumId: item.albumId ?? undefined, duration: item.duration ?? 0, coverArt: item.cover, genre: item.genre };
}
// The bridge already verified this copy using the current account's library.
// Old bridges still use the single-song endpoint; never invent a local identity.
export function matchedLibrarySong(item: CatalogItem): Song | undefined {
  const song = item.librarySong;
  return item.kind === 'track' && item.libraryMatch && song?.id === item.libraryMatch && !song.qobuzId
    && typeof song.title === 'string' && typeof song.artist === 'string' && Number.isFinite(song.duration) ? song : undefined;
}
export function songCatalogItem(song: Song): CatalogItem {
  return { id: song.qobuzId!, kind: 'track', title: song.title, artist: song.artist,
    album: song.album ?? '', albumId: song.qobuzAlbumId, duration: song.duration, cover: song.coverArt, available: true };
}
export function mergeCatalog(previous: Catalog, page: Catalog): Catalog {
  const items = new Map(previous.items.map(item => [item.kind + ':' + item.id, item]));
  page.items.forEach(item => items.set(item.kind + ':' + item.id, item));
  return { ...page, items: [...items.values()], libraryChecked: previous.libraryChecked && page.libraryChecked };
}
