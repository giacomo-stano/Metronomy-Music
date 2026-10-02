import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Keyboard, ScrollView, Text, TextInput, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Pressable from './SpringPressable';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { coverURL, request, accountStorageKey, isConnectivityFailure, type Album, type SearchResponse, type Song } from './api';
import { useTheme } from './theme';
import GlassBackground from './GlassBackground';
import Discover from './Discover';
import { DownloadBadge } from './OfflineDownloads';
import { ScreenCache } from './ScreenCache';
import CatalogRows from './CatalogRows';
import NetworkActions from './NetworkActions';
import { catalogSong, mergeCatalog, type Catalog, type CatalogItem } from './networkCatalog';

type Job = { id: string; title: string; status: string; message: string };
type Detail = { endpoint: string; title: string };
type Props = { active: boolean; revision: number; offline: boolean; onSettings: () => void; onPlay: (song: Song) => void; onAlbum: (album: Album) => void; onAlbumActions: (album: Album) => void; initialQuery: string; onActions: (song: Song) => void; onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void };
const labels: Record<string, string> = { queued: 'In coda', downloading: 'Download in corso', completed: 'Scaricato', failed: 'Non completato' };
const message = (e: unknown) => isConnectivityFailure(e) ? 'Connessione non disponibile.' : e instanceof Error ? e.message : 'Connessione non riuscita';

export default function SearchScreen({ active: isActive, revision, offline, onSettings, onPlay, onAlbum, onAlbumActions, initialQuery, onActions, onScroll }: Props) {
  const { colors: c } = useTheme();
  const [query, setQuery] = useState(initialQuery), [scope, setScope] = useState<'qobuz' | 'library'>(initialQuery || offline ? 'library' : 'qobuz');
  const [searchStorageKey] = useState(() => accountStorageKey('searches'));
  const [focused, setFocused] = useState(false), [dictationHelp, setDictationHelp] = useState(false);
  const [catalog, setCatalog] = useState<Catalog | null>(null), [local, setLocal] = useState<SearchResponse | null>(null);
  const [detail, setDetail] = useState<Detail[]>([]), [action, setAction] = useState<CatalogItem | null>(null);
  const [recent, setRecent] = useState<string[]>([]), [jobs, setJobs] = useState<Job[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [reload, setReload] = useState(0);
  const input = useRef<TextInput>(null), scroll = useRef<ScrollView>(null);
  const cache = useRef(new ScreenCache<SearchResponse | Catalog>()).current;
  const generation = useRef(0), playGeneration = useRef(0), alive = useRef(true), recentTouched = useRef(false), recentWrites = useRef(Promise.resolve());
  const page = detail.at(-1);
  const endpoint = page?.endpoint ?? (scope === 'qobuz' ? 'network/search?q=' : 'search?q=') + encodeURIComponent(query.trim());
  useEffect(() => {
    alive.current = true;
    AsyncStorage.getItem(searchStorageKey).then(value => { if (alive.current && !recentTouched.current) { const parsed = JSON.parse(value || '[]'); if (Array.isArray(parsed)) setRecent(parsed.filter(v => typeof v === 'string').slice(0, 10)); } }).catch(() => {});
    return () => { alive.current = false; playGeneration.current++; };
  }, []);
  function saveRecent(values: string[]) { recentTouched.current = true; setRecent(values); recentWrites.current = recentWrites.current.then(() => AsyncStorage.setItem(searchStorageKey, JSON.stringify(values))).catch(() => {}); }
  function remember() { if (query.trim()) saveRecent([query.trim(), ...recent.filter(q => q !== query.trim())].slice(0, 10)); }
  function changeQuery(value: string) { playGeneration.current++; setDetail([]); setQuery(value); }
  function closeSearch() { generation.current++; playGeneration.current++; changeQuery(''); setCatalog(null); setLocal(null); setError(''); setBusy(false); setFocused(false); setDictationHelp(false); input.current?.blur(); Keyboard.dismiss(); }
  useEffect(() => { if (!isActive) { playGeneration.current++; input.current?.blur(); setFocused(false); } }, [isActive]);
  useEffect(() => { changeQuery(initialQuery); if (initialQuery) setScope('library'); }, [initialQuery]);
  useEffect(() => { if (offline) { setScope('library'); setDetail([]); setAction(null); } }, [offline]);
  useEffect(() => {
    if (!isActive || offline || scope !== 'qobuz') return;
    let active = true; let timer: ReturnType<typeof setTimeout>;
    async function poll() { try { const data = await request<{ jobs: Job[] }>('network/downloads'); if (active) setJobs(old => JSON.stringify(old) === JSON.stringify(data.jobs) ? old : data.jobs); } catch { /* Search/playback errors are shown separately. */ } if (active) timer = setTimeout(poll, 5000); }
    void poll(); return () => { active = false; clearTimeout(timer); };
  }, [isActive, offline, scope, reload]);
  useEffect(() => {
    if (!isActive) return;
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
  }, [endpoint, query, page, scope, reload, revision, offline, isActive, cache]);
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
    remember(); input.current?.blur(); Keyboard.dismiss();
    if (item.kind !== 'track') { playGeneration.current++; setDetail(old => [...old, { endpoint: 'network/' + item.kind + '/' + encodeURIComponent(item.id), title: item.title }]); scroll.current?.scrollTo({ y: 0, animated: true }); return; }
    if (item.libraryMatch) {
      const version = ++playGeneration.current;
      try { const data = await request<{ song: Song }>('songs/' + encodeURIComponent(item.libraryMatch)); if (alive.current && version === playGeneration.current) onPlay(data.song); } catch (e) { if (alive.current && version === playGeneration.current) Alert.alert('Riproduzione', message(e)); }
    } else if (item.available) { playGeneration.current++; onPlay(catalogSong(item)); }
    else Alert.alert('Non disponibile', 'Questo brano non è riproducibile con l’account Qobuz configurato.');
  }
  const text = { color: c.text, fontSize: 16 }, sub = { color: c.secondary, fontSize: 13, marginTop: 4 };
  const row = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, paddingVertical: 14, borderBottomWidth: 0.5, borderColor: c.border };
  const art = (url?: string) => url ? <Image source={{ uri: url }} style={{ width: 54, height: 54, borderRadius: 8 }} /> : <View style={{ width: 54, height: 54, backgroundColor: c.surface, borderRadius: 8 }} />;
  return <View style={{ flex: 1 }}><View style={{ padding: 20, paddingBottom: 4 }}>
    {!focused && <View style={row}><Text style={{ color: c.text, fontSize: 36, fontWeight: '800', flex: 1 }}>Cerca</Text><Pressable onPress={onSettings} accessibilityLabel="Apri impostazioni"><Ionicons name="person-circle-outline" size={38} color={c.accent} /></Pressable></View>}
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 }}><View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', borderRadius: 28, borderWidth: 0.5, borderColor: c.border, overflow: 'hidden', paddingLeft: 15, minHeight: 54 }}><GlassBackground /><Ionicons name="search" size={23} color={c.text} /><TextInput ref={input} style={{ ...text, paddingVertical: 14, paddingHorizontal: 10, flex: 1, minWidth: 0 }} placeholder="Artisti, brani e album" placeholderTextColor={c.secondary} value={query} onChangeText={changeQuery} onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); setDictationHelp(false); }} onSubmitEditing={() => { remember(); Keyboard.dismiss(); }} returnKeyType="search" autoCorrect={false} autoCapitalize="none" accessibilityLabel="Cerca musica" maxLength={200} selectionColor={c.accent} /><Pressable onPress={() => { setDictationHelp(true); input.current?.focus(); }} accessibilityLabel="Dettatura con la tastiera" style={{ width: 44, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="mic-outline" color={c.text} size={25} /></Pressable></View>{(focused || !!query || dictationHelp) && <Pressable onPress={closeSearch} accessibilityLabel="Chiudi e cancella ricerca" style={{ width: 54, height: 54, borderRadius: 27, overflow: 'hidden', borderWidth: 0.5, borderColor: c.border, alignItems: 'center', justifyContent: 'center' }}><GlassBackground /><Ionicons name="close" color={c.text} size={32} /></Pressable>}</View>
    {dictationHelp && <Text style={{ ...sub, paddingVertical: 10 }}>Per dettare, tocca il microfono della tastiera. Su iPhone: Impostazioni → Generali → Tastiera → Abilita dettatura.</Text>}
    <View style={{ flexDirection: 'row', borderRadius: 24, backgroundColor: c.surface, padding: 4, marginTop: 12 }}>{(['qobuz', 'library'] as const).map(value => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: scope === value }} onPress={() => { if (value === 'qobuz' && offline) Alert.alert('Qobuz richiede internet', 'Riconnettiti per accedere a Qobuz.'); else { setScope(value); setDetail([]); } }} style={{ flex: 1, padding: 10, alignItems: 'center', borderRadius: 20, backgroundColor: scope === value ? c.background : 'transparent' }}><Text style={text}>{value === 'qobuz' ? 'Qobuz' : 'Libreria'}</Text></Pressable>)}</View>
  </View><ScrollView ref={scroll} onScroll={onScroll} scrollEventThrottle={32} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingBottom: 200 }}>
    {page && <Pressable onPress={() => setDetail(old => old.slice(0, -1))} style={row} accessibilityLabel="Torna ai risultati"><Ionicons name="chevron-back" color={c.accent} size={24} /><Text style={{ ...text, fontSize: 24, fontWeight: '700', flex: 1 }}>{page.title}</Text></Pressable>}
    {!query.trim() && !page && focused && <><View style={row}><Text style={{ ...text, flex: 1, fontWeight: '700', fontSize: 22 }}>Ricerche recenti</Text><Pressable onPress={() => saveRecent([])}><Text style={{ color: c.accent }}>Cancella</Text></Pressable></View>{recent.map(value => <Pressable key={value} onPress={() => changeQuery(value)} style={row}><Ionicons name="time-outline" size={23} color={c.secondary} /><Text style={{ ...text, flex: 1 }}>{value}</Text></Pressable>)}{!recent.length && <Text style={sub}>Le ricerche selezionate o confermate appariranno qui.</Text>}</>}
    {!query.trim() && !page && !focused && <Discover active={isActive} revisionKey={String(offline) + ':' + revision + ':' + reload} scope={scope} onAlbum={onAlbum} onOpen={item => void openItem(item)} onActions={setAction} />}
    {!!error && <Pressable onPress={() => setReload(v => v + 1)}><Text style={{ color: c.accent }}>{error} · Riprova</Text></Pressable>}
    {catalog && <CatalogRows items={catalog.items} onOpen={item => void openItem(item)} onActions={setAction} />}
    {!!local?.artists.length && <Text style={{ ...text, fontSize: 23, fontWeight: '700', marginTop: 18 }}>Artisti</Text>}{local?.artists.map(artist => <Pressable key={'artist:' + artist.id} style={row} onPress={() => { remember(); setDetail(old => [...old, { endpoint: 'library/artists/' + encodeURIComponent(artist.id), title: artist.name }]); }}><Ionicons name="person-circle-outline" size={48} color={c.secondary} /><Text style={{ ...text, flex: 1 }}>{artist.name}</Text><Ionicons name="chevron-forward" size={20} color={c.secondary} /></Pressable>)}
    {!!local?.albums.length && <Text style={{ ...text, fontSize: 23, fontWeight: '700', marginTop: 18 }}>Album</Text>}{local?.albums.map(album => <View key={'album:' + album.id} style={row}><Pressable style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 }} onPress={() => { remember(); onAlbum(album); }}>{art(coverURL(album.coverArt))}<View style={{ flex: 1 }}><Text style={text}>{album.name}</Text><Text style={sub}>{album.artist}</Text></View></Pressable><Pressable onPress={() => onAlbumActions(album)} accessibilityLabel={'Opzioni album ' + album.name} style={{ padding: 12 }}><Ionicons name="ellipsis-horizontal" size={24} color={c.secondary} /></Pressable></View>)}
    {!!local?.songs.length && <Text style={{ ...text, fontSize: 23, fontWeight: '700', marginTop: 18 }}>Brani</Text>}{local?.songs.map(song => <View key={song.id} style={row}><Pressable style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 }} onPress={() => { remember(); playGeneration.current++; onPlay(song); }}>{art(coverURL(song.coverArt))}<View style={{ flex: 1 }}><Text style={text}>{song.title}</Text><Text style={sub}>{song.artist}</Text></View></Pressable><DownloadBadge song={song} /><Pressable accessibilityLabel={'Opzioni per ' + song.title} style={{ padding: 12 }} onPress={() => onActions(song)}><Ionicons name="ellipsis-horizontal" size={24} color={c.secondary} /></Pressable></View>)}
    {busy && <ActivityIndicator color={c.accent} style={{ margin: 24 }} />}
    {!busy && ((catalog && !catalog.items.length) || (local && !local.songs.length && !local.albums.length && !local.artists.length)) && <Text style={sub}>Nessun risultato.</Text>}
    {catalog?.hasMore && <Pressable disabled={busy} onPress={() => void more()} style={{ padding: 16 }}><Text style={{ color: c.accent }}>Altri risultati</Text></Pressable>}
    {scope === 'qobuz' && jobs.some(j => j.status !== 'completed') && <><Text style={{ ...text, fontSize: 22, fontWeight: '700', marginTop: 30 }}>Download sul server</Text>{jobs.filter(j => j.status !== 'completed').slice(0, 8).map(job => <View key={job.id} style={{ paddingVertical: 12 }}><Text style={text}>{job.title}</Text><Text style={sub}>{labels[job.status]}{job.message ? ' · ' + job.message : ''}</Text></View>)}</>}
  </ScrollView>{action && <NetworkActions key={action.kind + action.id} item={action} onClose={() => setAction(null)} onPlay={() => void openItem(action)} onDownloaded={() => setReload(v => v + 1)} />}</View>;
}
