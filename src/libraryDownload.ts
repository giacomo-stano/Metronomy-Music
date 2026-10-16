import type { Song } from './api';

// Read the entire account-scoped library, not just the visible FlatList page.
export async function collectLibrarySongs(
  read: (path: string) => Promise<{ songs?: Song[]; hasMore?: boolean; nextOffset?: number }>,
  alive: () => boolean,
  progress: (count: number) => void,
): Promise<Song[]> {
  const songs = new Map<string, Song>();
  let offset = 0;
  while (alive()) {
    const page = await read('library/songs?sort=title&offset=' + offset);
    if (!alive()) return [];
    if (!Array.isArray(page.songs) || page.songs.some(s => !s?.id || s.qobuzId)) {
      throw new Error('Risposta libreria non valida. Nessun download avviato.');
    }
    const before = songs.size;
    for (const song of page.songs) songs.set(song.id, song);
    progress(songs.size);
    if (!page.hasMore) return [...songs.values()];
    const next = page.nextOffset ?? offset + page.songs.length;
    if (!Number.isInteger(next) || next <= offset || songs.size === before) {
      throw new Error('Impossibile completare la lista dei brani. Riprova.');
    }
    offset = next;
  }
  return [];
}
