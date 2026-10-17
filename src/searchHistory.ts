export type SearchHistoryEntry = {
  query: string; scope: 'qobuz' | 'library'; kind: 'query' | 'artist' | 'album' | 'track';
  title: string; subtitle?: string; cover?: string;
};
const key = (entry: SearchHistoryEntry) => entry.scope + ':' + entry.kind + ':' + entry.query.toLocaleLowerCase();
export function readSearchHistory(value: unknown): SearchHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: SearchHistoryEntry[] = [];
  for (const raw of value) {
    if (typeof raw === 'string' && raw.trim()) {
      entries.push({ query: raw.slice(0, 200), title: raw.slice(0, 200), scope: 'qobuz', kind: 'query' });
    } else if (raw && typeof raw === 'object' && typeof raw.query === 'string' && raw.query.trim() &&
        typeof raw.title === 'string' && ['qobuz', 'library'].includes(raw.scope) &&
        ['query', 'artist', 'album', 'track'].includes(raw.kind)) {
      // Store display metadata only, never tokens, playback URLs or a stale match.
      const cover = typeof raw.cover === 'string' && (!raw.cover.includes('://') || /^https:\/\//.test(raw.cover)) &&
        !/[?&#@]/.test(raw.cover) ? raw.cover : undefined;
      entries.push({ query: raw.query.slice(0, 200), title: raw.title.slice(0, 200), scope: raw.scope,
        kind: raw.kind, subtitle: typeof raw.subtitle === 'string' ? raw.subtitle.slice(0, 200) : undefined, cover });
    }
  }
  return [...new Map(entries.map(entry => [key(entry), entry])).values()].slice(0, 10);
}
export function addSearchHistory(previous: SearchHistoryEntry[], entry: SearchHistoryEntry) {
  return readSearchHistory([entry, ...previous.filter(old => key(old) !== key(entry))]);
}
