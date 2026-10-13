import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Pressable from './SpringPressable';
import GlassBackground from './GlassBackground';
import { useScreenInsets } from './ScreenInsets';
import { useTheme } from './theme';
import { request, type Song } from './api';
import { albumTracks, catalogQueue } from './catalogPlayback';
import { mergeCatalog, type Catalog, type CatalogItem } from './networkCatalog';
import NetworkActions from './NetworkActions';
import { ServerDownloadBadge } from './ServerDownloads';

export default function CatalogAlbumsPage({ artist, initial, active, revision, onBack, onOpen, onPlay, onScroll }: {
  artist: CatalogItem; initial: Catalog; active: boolean; revision: number; onBack: () => void;
  onOpen: (item: CatalogItem) => void; onPlay: (songs: Song[]) => void; onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
}) {
  const { colors: c } = useTheme();
  const insets = useScreenInsets(), { width } = useWindowDimensions();
  const [data, setData] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [action, setAction] = useState<CatalogItem | null>(null), [sort, setSort] = useState<'date' | 'title'>('date');
  const generation = useRef(0), loading = useRef(false), loadedRevision = useRef(revision);
  const playingGeneration = useRef(0), activeRef = useRef(active);
  activeRef.current = active;
  const endpoint = 'network/artist/' + encodeURIComponent(artist.id);
  useEffect(() => () => { generation.current++; playingGeneration.current++; }, []);
  useEffect(() => {
    if (!active) { setAction(null); playingGeneration.current++; }
    if (!active || loadedRevision.current === revision) return;
    // Refresh metadata without dropping already paginated albums or scroll position.
    void load(false);
  }, [active, revision]);
  async function play(item: CatalogItem) {
    const version = ++playingGeneration.current;
    const valid = () => version === playingGeneration.current && activeRef.current;
    try { const tracks = await albumTracks(item.id, request, valid); const queue = await catalogQueue(tracks, request, valid); if (valid() && queue.length) onPlay(queue); }
    catch (e) { if (valid()) setError(e instanceof Error ? e.message : 'Riproduzione non disponibile.'); }
  }
  async function load(more: boolean) {
    if (loading.current || (more && !data.hasMore)) return;
    const version = generation.current;
    loading.current = true; setBusy(true); setError('');
    try {
      const page = await request<Catalog>(endpoint + (more ? '?offset=' + data.nextOffset : ''), 100000);
      if (version !== generation.current) return;
      setData(old => more ? mergeCatalog(old, page) : { ...old, items: mergeCatalog(old, page).items });
      loadedRevision.current = revision;
    } catch (e) { if (version === generation.current) setError(e instanceof Error ? e.message : 'Catalogo non disponibile.'); }
    finally { loading.current = false; if (version === generation.current) setBusy(false); }
  }
  const albums = useMemo(() => [...data.items].sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title, 'it') : (b.releaseDate ?? '').localeCompare(a.releaseDate ?? '') || a.title.localeCompare(b.title, 'it')), [data.items, sort]);
  const size = (width - 52) / 2;
  return <View style={{ flex: 1, backgroundColor: c.background }}>
    <FlatList data={albums} keyExtractor={item => item.id} numColumns={2} columnWrapperStyle={{ gap: 12 }} contentInsetAdjustmentBehavior="never" contentContainerStyle={{ paddingHorizontal: 20, paddingTop: insets.top + 78, paddingBottom: 200 }} onScroll={onScroll} scrollEventThrottle={32}
      ListHeaderComponent={<View style={{ marginBottom: 24 }}><Text style={{ fontSize: 34, fontWeight: '800', color: c.text }}>Album</Text><Text style={{ color: c.secondary, fontSize: 20, marginTop: 6 }}>{artist.title}</Text><Text style={{ color: c.secondary, marginTop: 8 }}>Discografia · {albums.length}{data.hasMore ? '+' : ''} uscite</Text><View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>{(['date', 'title'] as const).map(value => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: sort === value }} onPress={() => setSort(value)} style={{ padding: 12, borderRadius: 22, backgroundColor: c.surface }}><Text style={{ color: sort === value ? c.accent : c.secondary }}>{value === 'date' ? 'Più recenti' : 'Titolo A–Z'}</Text></Pressable>)}</View></View>}
      renderItem={({ item }) => <View style={{ width: size, marginBottom: 24 }}><Pressable onPress={() => onOpen(item)} onLongPress={() => setAction(item)} accessibilityLabel={'Apri album ' + item.title}>{item.cover ? <Image source={{ uri: item.cover }} style={{ width: size, height: size, borderRadius: 10, backgroundColor: c.surface }} /> : <View style={{ width: size, height: size, borderRadius: 10, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="albums-outline" size={48} color={c.secondary} /></View>}<Text numberOfLines={2} style={{ color: c.text, fontSize: 16, marginTop: 10 }}>{item.title}</Text></Pressable><View style={{ flexDirection: 'row', alignItems: 'center' }}><Text style={{ color: c.secondary, flex: 1 }}>{item.releaseDate?.slice(0, 4)}</Text><ServerDownloadBadge item={item} /><Pressable onPress={() => setAction(item)} accessibilityLabel={'Opzioni album ' + item.title} style={{ padding: 10 }}><Ionicons name="ellipsis-horizontal" size={21} color={c.secondary} /></Pressable></View></View>}
      ListEmptyComponent={<Text style={{ color: c.secondary }}>Nessun album disponibile.</Text>}
      ListFooterComponent={<View>{busy && <ActivityIndicator color={c.accent} style={{ margin: 20 }} />}{!!error && <Text style={{ color: c.accent }}>{error}</Text>}{(data.hasMore || !!error) && <Pressable disabled={busy} onPress={() => void load(data.hasMore)} style={{ paddingVertical: 20 }}><Text style={{ color: c.accent }}>{error ? 'Riprova' : 'Carica altri album'}</Text></Pressable>}</View>} />
    <View style={{ position: 'absolute', left: 0, top: 0, right: 0, paddingTop: insets.top + 10, paddingHorizontal: 16, paddingBottom: 10, backgroundColor: c.background }}><Pressable onPress={onBack} accessibilityLabel="Torna all’artista" style={{ width: 46, height: 46, borderRadius: 23, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}><GlassBackground /><Ionicons name="chevron-back" size={27} color={c.text} /></Pressable></View>
    {action && <NetworkActions item={action} onClose={() => setAction(null)} onPlay={() => void play(action)} />}
  </View>;
}
