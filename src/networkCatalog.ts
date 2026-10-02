import type { Song } from './api';
export type CatalogItem = { id: string; kind: 'track' | 'album' | 'artist'; title: string; artist: string; album: string; duration?: number; genre?: string; cover?: string; available: boolean; libraryMatch?: string | null };
export type Catalog = { items: CatalogItem[]; hasMore: boolean; nextOffset?: number; libraryChecked: boolean; title?: string; personalized?: boolean; genres?: string[] };
export function catalogSong(item: CatalogItem): Song {
  return { id: 'qobuz:' + item.id, qobuzId: item.id, title: item.title, artist: item.artist,
    album: item.album, duration: item.duration ?? 0, coverArt: item.cover, genre: item.genre };
}
export function songCatalogItem(song: Song): CatalogItem {
  return { id: song.qobuzId!, kind: 'track', title: song.title, artist: song.artist,
    album: song.album ?? '', duration: song.duration, cover: song.coverArt, available: true };
}
export function mergeCatalog(previous: Catalog, page: Catalog): Catalog {
  const items = new Map(previous.items.map(item => [item.kind + ':' + item.id, item]));
  page.items.forEach(item => items.set(item.kind + ':' + item.id, item));
  return { ...page, items: [...items.values()], libraryChecked: previous.libraryChecked && page.libraryChecked };
}
