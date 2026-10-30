import { matchedLibrarySong } from './networkCatalog';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Keyboard, Text, TextInput, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Pressable from './SpringPressable';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { coverURL, request, accountStorageKey, isConnectivityFailure, type Album, type SearchResponse, type Song } from './api';
import { useTheme } from './theme';
import SearchScaffold from './SearchScaffold';
import { addSearchHistory, readSearchHistory, type SearchHistoryEntry } from './searchHistory';
import Discover from './Discover';
import { DownloadBadge } from './OfflineDownloads';
import { ScreenCache } from './ScreenCache';
import CatalogSearchResults from './CatalogSearchResults';
import CatalogBrowser from './CatalogBrowser';
import { albumTracks, catalogQueue } from './catalogPlayback';
import NetworkActions from './NetworkActions';
import { catalogSong, mergeCatalog, type Catalog, type CatalogItem } from './networkCatalog';
import { useServerDownloads } from './ServerDownloads';

type Detail = { endpoint: string; title: string };
type Props = { active: boolean; resetKey: number; revision: number; offline: boolean; onSettings: () => void; onDetailChange: (open: boolean) => void; onPlay: (song: Song) => void; onPlayQueue: (songs: Song[]) => void; onAlbum: (album: Album) => void; onAlbumActions: (album: Album) => void; initialQuery: string; onActions: (song: Song) => void; onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void };
const labels: Record<string, string> = { queued: 'In coda', downloading: 'Download in corso', completed: 'Scaricato', failed: 'Non completato' };
const message = (e: unknown) => isConnectivityFailure(e) ? 'Connessione non disponibile.' : e instanceof Error ? e.message : 'Connessione non riuscita';

export default function SearchScreen({ active: isActive, resetKey, revision, offline, onSettings, onDetailChange, onPlay, onPlayQueue, onAlbum, onAlbumActions, initialQuery, onActions, onScroll }: Props) {
  const { colors: c } = useTheme();
  const [query, setQuery] = useState(initialQuery), [scope, setScope] = useState<'qobuz' | 'library'>(initialQuery || offline ? 'library' : 'qobuz');
  const [searchStorageKey] = useState(() => accountStorageKey('searches'));
  const [focused, setFocused] = useState(false), [dictationHelp, setDictationHelp] = useState(false);
  const [engaged, setEngaged] = useState(!!initialQuery);
  const [catalog, setCatalog] = useState<Catalog | null>(null), [local, setLocal] = useState<SearchResponse | null>(null);
  const [detail, setDetail] = useState<Detail[]>([]), [action, setAction] = useState<CatalogItem | null>(null);
  const [browser, setBrowser] = useState<CatalogItem | null>(null);
  const [recent, setRecent] = useState<SearchHistoryEntry[]>([]);
  const { jobs } = useServerDownloads();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [reload, setReload] = useState(0);
  const input = useRef<TextInput>(null);
  const cache = useRef(new ScreenCache<SearchResponse | Catalog>()).current;
  const generation = useRef(0), playGeneration = useRef(0), alive = useRef(true), recentTouched = useRef(false), recentWrites = useRef(Promise.resolve());
  const page = detail.at(-1);
  const searching = engaged || !!query.trim() || !!page;
  const endpoint = page?.endpoint ?? (scope === 'qobuz' ? 'network/search?q=' : 'search?q=') + encodeURIComponent(query.trim());
  useEffect(() => { onDetailChange(!!browser && isActive); return () => onDetailChange(false); }, [browser, isActive, onDetailChange]);
  useEffect(() => {
    alive.current = true;
    AsyncStorage.getItem(searchStorageKey).then(value => { if (alive.current && !recentTouched.current) { const parsed = JSON.parse(value || '[]'); setRecent(readSearchHistory(parsed)); } }).catch(() => {});
    return () => { alive.current = false; playGeneration.current++; };
  }, []);
  function saveRecent(values: SearchHistoryEntry[]) { recentTouched.current = true; setRecent(values); recentWrites.current = recentWrites.current.then(() => AsyncStorage.setItem(searchStorageKey, JSON.stringify(values))).catch(() => {}); }
  function remember(entry?: SearchHistoryEntry) {
    const value = entry ?? (query.trim() ? { query: query.trim(), title: query.trim(), scope, kind: 'query' as const } : undefined);
    if (value) saveRecent(addSearchHistory(recent, value));
  }
  function changeQuery(value: string) { playGeneration.current++; setDetail([]); setBrowser(null); setQuery(value); }
  function closeSearch() { generation.current++; playGeneration.current++; changeQuery(''); setCatalog(null); setLocal(null); setError(''); setBusy(false); setFocused(false); setEngaged(false); setDictationHelp(false); input.current?.blur(); Keyboard.dismiss(); }
  const lastReset = useRef(resetKey);
  useEffect(() => {
    if (lastReset.current === resetKey) return;
    lastReset.current = resetKey;
    closeSearch(); setAction(null); setScope(offline ? 'library' : 'qobuz');
  }, [resetKey]);
  useEffect(() => { if (!isActive) { playGeneration.current++; input.current?.blur(); setFocused(false); } }, [isActive]);
  useEffect(() => { changeQuery(initialQuery); if (initialQuery) setScope('library'); }, [initialQuery]);
  useEffect(() => { if (offline) { setScope('library'); setDetail([]); setBrowser(null); setAction(null); } }, [offline]);
  useEffect(() => {
    if (!isActive || browser) return;
    const version = ++generation.current;
    cache.useScope(String(offline) + ':' + revision + ':' + reload);
    const cached = cache.peek(endpoint);
    const accept = (data: Catalog | SearchResponse) => { if (scope === 'qobuz') { setCatalog(data as Catalog); setLocal(null); } else { setLocal(data as SearchResponse); setCatalog(null); } };
    if (!query.trim() && !page) { setCatalog(null); setLocal(null); setBusy(false); setError(''); return; }
    if (cached) { accept(cached); setBusy(false); setError(''); return; }
    setCatalog(null); setLocal(null); setError(''); setBusy(true);
    const timer = setTimeout(async () => {
      try {
        const result = await cache.get(endpoint, async () => {
          const data = await request<Catalog | SearchResponse>(endpoint, 100000);
          return scope === 'library' ? { artists: [], songs: [], albums: [], ...data } : data;
        });
        if (version === generation.current) accept(result);
      } catch (e) { if (version === generation.current) setError(message(e)); }
      finally { if (version === generation.current) setBusy(false); }
    }, page ? 0 : 400);
    return () => { clearTimeout(timer); generation.current++; };
  }, [endpoint, query, page, scope, reload, revision, offline, isActive, cache, browser]);
  async function more() {
    if (busy || !catalog?.hasMore) return;
    const version = generation.current; setBusy(true);
    try {
      const data = await request<Catalog>(endpoint + (endpoint.includes('?') ? '&' : '?') + 'offset=' + (catalog.nextOffset ?? 0), 100000);
      if (version === generation.current) setCatalog(old => { const next = old ? mergeCatalog(old, data) : data; cache.set(endpoint, next); return next; });
    } catch (e) { if (version === generation.current) setError(message(e)); }
    finally { if (version === generation.current) setBusy(false); }
  }
  async function openItem(item: CatalogItem) {
    remember({ query: item.title, title: item.title, kind: item.kind, scope: 'qobuz', subtitle: item.kind === 'artist' ? 'Artista' : (item.kind === 'album' ? 'Album' : 'Brano') + ' · ' + item.artist, cover: item.cover }); input.current?.blur(); Keyboard.dismiss();
    if (item.kind !== 'track') { playGeneration.current++; setBrowser(item); return; }
    const matched = matchedLibrarySong(item);
    if (matched) { playGeneration.current++; onPlay(matched); return; }
    if (item.libraryMatch) {
      const version = ++playGeneration.current;
      try { const data = await request<{ song: Song }>('songs/' + encodeURIComponent(item.libraryMatch)); if (alive.current && version === playGeneration.current) onPlay(data.song); } catch (e) { if (alive.current && version === playGeneration.current) Alert.alert('Riproduzione', message(e)); }
    } else if (item.available) { playGeneration.current++; onPlay(catalogSong(item)); }
    else Alert.alert('Non disponibile', 'Questo brano non è riproducibile con l’account Qobuz configurato.');
  }
  async function playAction(item: CatalogItem) {
    if (item.kind !== 'album') { void openItem(item); return; }
    const version = ++playGeneration.current;
    const valid = () => alive.current && version === playGeneration.current;
    try { const queue = await catalogQueue(await albumTracks(item.id, request, valid), request, valid); if (valid() && queue.length) onPlayQueue(queue); }
    catch (e) { if (valid()) Alert.alert('Riproduzione', message(e)); }
  }
  const text = { color: c.text, fontSize: 16 }, sub = { color: c.secondary, fontSize: 13, marginTop: 4 };
  const row = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, paddingVertical: 14, borderBottomWidth: 0.5, borderColor: c.border };
  const art = (url?: string) => url ? <Image source={{ uri: url }} style={{ width: 54, height: 54, borderRadius: 8 }} /> : <View style={{ width: 54, height: 54, backgroundColor: c.surface, borderRadius: 8 }} />;
  return <View style={{ flex: 1 }}><View style={{ flex: 1, display: browser ? 'none' : 'flex' }}>
    <SearchScaffold query={query} scope={scope} searching={searching} resetKey={resetKey} input={input}
      onChange={changeQuery} onFocus={() => { setFocused(true); setEngaged(true); }}
      onBlur={() => { setFocused(false); setDictationHelp(false); }} onSubmit={() => remember()} onClose={closeSearch}
      onDictation={() => setDictationHelp(true)} onSettings={onSettings} onScroll={onScroll}
      onScope={value => { if (value === scope) return; if (value === 'qobuz' && offline) Alert.alert('Qobuz richiede internet', 'Riconnettiti per accedere a Qobuz.');
        else { generation.current++; setScope(value); setDetail([]); setCatalog(null); setLocal(null); setError(''); } }}
      browse={<Discover active={isActive && !searching && !browser} revisionKey={String(offline) + ':' + revision + ':' + reload} scope={scope} onAlbum={onAlbum} onOpen={item => void openItem(item)} onActions={setAction} />}>
    {dictationHelp && <Text style={{ ...sub, paddingVertical: 10 }}>Per dettare, tocca il microfono della tastiera. Su iPhone: Impostazioni → Generali → Tastiera → Abilita dettatura.</Text>}
    {page && <Pressable onPress={() => setDetail(old => old.slice(0, -1))} style={row} accessibilityLabel="Torna ai risultati"><Ionicons name="chevron-back" color={c.accent} size={24} /><Text style={{ ...text, fontSize: 24, fontWeight: '700', flex: 1 }}>{page.title}</Text></Pressable>}
    {!query.trim() && !page && searching && <>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 0.5, borderColor: c.border }}>
        <Text style={{ ...text, flex: 1, fontWeight: '700', fontSize: 20 }}>Ricerche recenti</Text>
        <Pressable onPress={() => saveRecent([])} accessibilityLabel="Cancella ricerche recenti" style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: c.accent, fontSize: 17 }}>Cancella</Text></Pressable>
      </View>
      {recent.filter(value => !offline || value.scope === 'library').map(value => <Pressable key={value.scope + ':' + value.kind + ':' + value.query}
        onPress={() => { setScope(value.scope); changeQuery(value.query); }} accessibilityLabel={'Cerca ' + value.title} style={row}>
        {value.cover ? <Image source={{ uri: coverURL(value.cover) }} style={{ width: 54, height: 54, borderRadius: value.kind === 'artist' ? 27 : 5 }} />
          : <View style={{ width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface }}><Ionicons name={value.kind === 'artist' ? 'person' : value.kind === 'query' ? 'time-outline' : 'musical-notes'} size={26} color={c.secondary} /></View>}
        <View style={{ flex: 1 }}><Text numberOfLines={1} style={{ ...text, fontSize: 17 }}>{value.title}</Text>
          {!!value.subtitle && <Text numberOfLines={1} style={sub}>{value.subtitle}</Text>}
          {value.scope === 'library' && <Text style={{ ...sub, fontSize: 12 }}>Dalla tua libreria</Text>}
        </View><Ionicons name="chevron-forward" size={18} color={c.secondary} />
      </Pressable>)}
      {!recent.some(value => !offline || value.scope === 'library') && <Text style={{ ...sub, paddingVertical: 16 }}>Le ricerche selezionate o confermate appariranno qui.</Text>}
    </>}
    {!!error && <Pressable onPress={() => setReload(v => v + 1)}><Text style={{ color: c.accent }}>{error} · Riprova</Text></Pressable>}
    {catalog && <CatalogSearchResults items={catalog.items} query={query} focused={focused} onQuery={changeQuery} onOpen={item => void openItem(item)} onActions={setAction} />}
    {!!local?.artists.length && <Text style={{ ...text, fontSize: 23, fontWeight: '700', marginTop: 18 }}>Artisti</Text>}{local?.artists.map(artist => <Pressable key={'artist:' + artist.id} style={row} onPress={() => { remember({ query: artist.name, title: artist.name, kind: 'artist', scope: 'library', subtitle: 'Artista' }); input.current?.blur(); Keyboard.dismiss(); setDetail(old => [...old, { endpoint: 'library/artists/' + encodeURIComponent(artist.id), title: artist.name }]); }}><Ionicons name="person-circle-outline" size={48} color={c.secondary} /><Text style={{ ...text, flex: 1 }}>{artist.name}</Text><Ionicons name="chevron-forward" size={20} color={c.secondary} /></Pressable>)}
    {!!local?.albums.length && <Text style={{ ...text, fontSize: 23, fontWeight: '700', marginTop: 18 }}>Album</Text>}{local?.albums.map(album => <View key={'album:' + album.id} style={row}><Pressable style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 }} onPress={() => { remember({ query: album.name, title: album.name, kind: 'album', scope: 'library', subtitle: 'Album · ' + (album.artist ?? ''), cover: album.coverArt }); input.current?.blur(); Keyboard.dismiss(); onAlbum(album); }}>{art(coverURL(album.coverArt))}<View style={{ flex: 1 }}><Text style={text}>{album.name}</Text><Text style={sub}>{album.artist}</Text></View></Pressable><Pressable onPress={() => onAlbumActions(album)} accessibilityLabel={'Opzioni album ' + album.name} style={{ padding: 12 }}><Ionicons name="ellipsis-horizontal" size={24} color={c.secondary} /></Pressable></View>)}
    {!!local?.songs.length && <Text style={{ ...text, fontSize: 23, fontWeight: '700', marginTop: 18 }}>Brani</Text>}{local?.songs.map(song => <View key={song.id} style={row}><Pressable style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 }} onPress={() => { remember({ query: song.title, title: song.title, kind: 'track', scope: 'library', subtitle: 'Brano · ' + song.artist, cover: song.coverArt }); playGeneration.current++; onPlay(song); }}>{art(coverURL(song.coverArt))}<View style={{ flex: 1 }}><Text style={text}>{song.title}</Text><Text style={sub}>{song.artist}</Text></View></Pressable><DownloadBadge song={song} /><Pressable accessibilityLabel={'Opzioni per ' + song.title} style={{ padding: 12 }} onPress={() => onActions(song)}><Ionicons name="ellipsis-horizontal" size={24} color={c.secondary} /></Pressable></View>)}
    {busy && <ActivityIndicator color={c.accent} style={{ margin: 24 }} />}
    {!busy && ((catalog && !catalog.items.length) || (local && !local.songs.length && !local.albums.length && !local.artists.length)) && <Text style={sub}>Nessun risultato.</Text>}
    {catalog?.hasMore && <Pressable disabled={busy} onPress={() => void more()} style={{ padding: 16 }}><Text style={{ color: c.accent }}>Altri risultati</Text></Pressable>}
    {scope === 'qobuz' && jobs.some(j => j.status !== 'completed') && <><Text style={{ ...text, fontSize: 22, fontWeight: '700', marginTop: 30 }}>Download sul server</Text>{jobs.filter(j => j.status !== 'completed').slice(0, 8).map(job => <View key={job.id} style={{ paddingVertical: 12 }}><Text style={text}>{job.title}</Text><Text style={sub}>{labels[job.status]}{job.message ? ' · ' + job.message : ''}</Text></View>)}</>}
  </SearchScaffold></View>{browser && <CatalogBrowser key={browser.kind + browser.id} initial={browser} active={isActive} revision={revision + reload} onClose={() => setBrowser(null)} onPlay={onPlayQueue} onScroll={onScroll} />}{action && <NetworkActions key={action.kind + action.id} item={action} onClose={() => setAction(null)} onPlay={action.kind === 'artist' ? undefined : () => void playAction(action)} />}</View>;
}
