import type { Song } from './api';
import { catalogSong, mergeCatalog, type Catalog, type CatalogItem } from './networkCatalog';

type Fetch = <T>(path: string, timeout?: number) => Promise<T>;
export async function albumTracks(id: string, fetch: Fetch, valid: () => boolean = () => true): Promise<CatalogItem[]> {
  const path = 'network/album/' + encodeURIComponent(id);
  let page = await fetch<Catalog>(path, 100000);
  const offsets = new Set<number>();
  while (valid() && page.hasMore) {
    const offset = page.nextOffset;
    if (offset === undefined || offsets.has(offset) || offsets.size >= 20 || page.items.length >= 1000) throw new Error('Album troppo grande o paginazione incompleta. Apri l’album e scegli un brano.');
    offsets.add(offset);
    page = mergeCatalog(page, await fetch<Catalog>(path + '?offset=' + offset, 100000));
  }
  return valid() ? page.items : [];
}

export async function catalogQueue(items: CatalogItem[], fetch: Fetch, valid: () => boolean = () => true): Promise<Song[]> {
  const playable = items.filter(i => i.kind === 'track' && (i.available || i.libraryMatch));
  const songs: Song[] = new Array(playable.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, playable.length) }, async () => {
    while (valid() && next < playable.length) {
      const index = next++, item = playable[index];
      // Preserve the local-library identity, including offline copies and favourites.
      songs[index] = item.libraryMatch
        ? (await fetch<{ song: Song }>('songs/' + encodeURIComponent(item.libraryMatch))).song
        : catalogSong(item);
    }
  }));
  if (!valid()) return [];
  if (!songs.length) throw new Error('Nessun brano riproducibile con l’account Qobuz configurato.');
  return songs;
}
