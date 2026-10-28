import { isServerComplete } from './serverDownloadState';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, BackHandler, FlatList, Image, Modal, ScrollView, Share, StyleSheet, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Pressable from './SpringPressable';
import GlassBackground from './GlassBackground';
import { useScreenInsets } from './ScreenInsets';
import NetworkActions from './NetworkActions';
import { accountStorageKey, request, type Song } from './api';
import { DarkSurface, useTheme } from './theme';
import { useMotionPreferences } from './motionPreferences';
import { albumTracks, catalogQueue } from './catalogPlayback';
import { mergeCatalog, type ArtistProfile, type Catalog, type CatalogItem } from './networkCatalog';
import { ServerDownloadBadge } from './ServerDownloads';
import CatalogAlbumsPage from './CatalogAlbumsPage';

type Props = { initial: CatalogItem; active: boolean; revision: number; onClose: () => void; onPlay: (songs: Song[]) => void; onDownloaded: () => void; onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void };
const failure = (error: unknown) => error instanceof Error ? error.message : 'Impossibile caricare il catalogo. Riprova.';
const year = (item: CatalogItem) => item.releaseDate?.slice(0, 4) || '';
const share = (item: CatalogItem) => { void Share.share({ message: `https://open.qobuz.com/${item.kind}/${item.id}` }).catch(() => {}); };

export default function CatalogBrowser(props: Props) {
  const insets = useScreenInsets();
  const [pages, setPages] = useState<{ item: CatalogItem; albums?: Catalog }[]>([{ item: props.initial }]);
  const back = () => pages.length > 1 ? setPages(p => p.slice(0, -1)) : props.onClose();
  useEffect(() => {
    if (!props.active) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { back(); return true; });
    return () => subscription.remove();
  }, [props.active, pages.length]);
  function open(item: CatalogItem) {
    if (pages.length >= 12) { Alert.alert('Navigazione', 'Torna indietro prima di aprire un altro artista.'); return; }
    setPages(old => [...old, { item }]);
  }
  // Keep covered pages mounted: back restores the exact scroll position and loaded rails.
  return <DarkSurface><View style={[styles.fill, { marginTop: -insets.top }]}>{pages.map(({ item, albums }, index) => <View key={index + ':' + item.kind + ':' + item.id} style={[styles.fill, { display: index === pages.length - 1 ? 'flex' : 'none' }]}>{albums ? <CatalogAlbumsPage artist={item} initial={albums} active={props.active && index === pages.length - 1} revision={props.revision} onBack={back} onOpen={open} onPlay={props.onPlay} onScroll={props.onScroll} /> : <CatalogPage {...props} item={item} active={props.active && index === pages.length - 1} onBack={back} onOpen={open} onAlbums={(artist, catalog) => { if (pages.length < 12) setPages(old => [...old, { item: artist, albums: catalog }]); }} />}</View>)}</View></DarkSurface>;
}

function CatalogPage({ item, active, revision, onBack, onOpen, onAlbums, onPlay, onDownloaded, onScroll }: Props & { item: CatalogItem; onBack: () => void; onOpen: (item: CatalogItem) => void; onAlbums: (artist: CatalogItem, catalog: Catalog) => void }) {
  const { colors: c, isDark } = useTheme();
  const { reduceMotion } = useMotionPreferences();
  const { width } = useWindowDimensions();
  const insets = useScreenInsets();
  const [profile, setProfile] = useState<ArtistProfile | null>(null), [album, setAlbum] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [action, setAction] = useState<CatalogItem | null>(null), [info, setInfo] = useState(false);
  const [allTracks, setAllTracks] = useState(false), [moreBusy, setMoreBusy] = useState(false);
  const [playBusy, setPlayBusy] = useState(false), [favorite, setFavorite] = useState(false), [favoriteReady, setFavoriteReady] = useState(false), [favoriteBusy, setFavoriteBusy] = useState(false);
  const [favoriteKey] = useState(() => accountStorageKey('catalog-artist:' + item.id));
  const generation = useRef(0), mounted = useRef(true), activeRef = useRef(active), loadedRevision = useRef<number | null>(null);
  activeRef.current = active;
  const entrance = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const position = useRef(new Animated.Value(0)).current;
  const loadGeneration = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; }; }, []);
  useEffect(() => {
    if (!active) { generation.current++; setPlayBusy(false); setAction(null); setInfo(false); }
  }, [active]);
  useEffect(() => {
    Animated.timing(entrance, { toValue: 1, duration: reduceMotion ? 0 : 240, useNativeDriver: true }).start();
  }, [entrance, reduceMotion]);
  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(favoriteKey).then(value => { if (live) setFavorite(value === '1'); }).catch(() => {}).finally(() => { if (live) setFavoriteReady(true); });
    return () => { live = false; };
  }, [favoriteKey]);
  useEffect(() => {
    if (!active || loadedRevision.current === revision) return;
    const version = ++loadGeneration.current;
    setLoading(true); setError('');
    const path = 'network/' + item.kind + '/' + encodeURIComponent(item.id) + (item.kind === 'artist' ? '/profile' : '');
    request<ArtistProfile | Catalog>(path, 100000).then(data => {
      if (!mounted.current || version !== loadGeneration.current) return;
      if (item.kind === 'artist') setProfile(data as ArtistProfile); else setAlbum(data as Catalog);
      loadedRevision.current = revision;
    }).catch(e => { if (mounted.current && version === loadGeneration.current) setError(failure(e)); })
      .finally(() => { if (mounted.current && version === loadGeneration.current) setLoading(false); });
    return () => { loadGeneration.current++; };
  }, [active, revision, retry, item.id, item.kind]);

  async function play(items: CatalogItem[] | CatalogItem) {
    const version = ++generation.current;
    const valid = () => mounted.current && activeRef.current && generation.current === version;
    setPlayBusy(true);
    try {
      const tracks = Array.isArray(items) ? items : items.kind === 'album' ? (items.id === item.id && album && !album.hasMore ? album.items : await albumTracks(items.id, request, valid)) : [items];
      const queue = await catalogQueue(tracks, request, valid);
      if (valid() && queue.length) onPlay(queue);
    } catch (e) { if (valid()) Alert.alert('Riproduzione', failure(e)); }
    finally { if (valid()) setPlayBusy(false); }
  }
  async function toggleFavorite() {
    setFavoriteBusy(true);
    try { await AsyncStorage.setItem(favoriteKey, favorite ? '0' : '1'); if (mounted.current) { setFavorite(!favorite); if (!favorite) Alert.alert('Artista preferito', 'Salvato su questo dispositivo per l’account corrente.'); } }
    catch { if (mounted.current) Alert.alert('Preferiti', 'Impossibile salvare la preferenza.'); }
    finally { if (mounted.current) setFavoriteBusy(false); }
  }
  async function more() {
    const data = item.kind === 'artist' ? profile?.albums : album;
    if (moreBusy || !data?.hasMore) return;
    const version = loadGeneration.current;
    setMoreBusy(true);
    try {
      const next = await request<Catalog>('network/' + item.kind + '/' + encodeURIComponent(item.id) + '?offset=' + data.nextOffset, 100000);
      if (!mounted.current || version !== loadGeneration.current) return;
      if (item.kind === 'artist') setProfile(old => old ? { ...old, albums: mergeCatalog(old.albums, next) } : old);
      else setAlbum(old => old ? mergeCatalog(old, next) : next);
    } catch (e) { if (mounted.current && activeRef.current) Alert.alert('Catalogo', failure(e)); }
    finally { if (mounted.current) setMoreBusy(false); }
  }

  const current = profile?.artist ?? album?.album ?? item;
  const circle = (icon: keyof typeof Ionicons.glyphMap, label: string, fn: () => void, disabled = false) => <Pressable disabled={disabled} onPress={fn} accessibilityRole="button" accessibilityLabel={label} style={[styles.circle, { borderColor: c.border, opacity: disabled ? 0.45 : 1 }]}><GlassBackground /><Ionicons name={icon} color={c.text} size={27} /></Pressable>;
  const heading = (title: string, fn?: () => void) => <Pressable disabled={!fn} onPress={fn} accessibilityRole={fn ? 'button' : 'header'} style={styles.heading}><Text style={{ color: c.text, fontSize: 23, fontWeight: '700' }}>{title}</Text>{fn && <Ionicons name="chevron-forward" size={24} color={c.secondary} />}</Pressable>;
  function artwork(value: CatalogItem, size: number, round = false) {
    return value.cover ? <Image source={{ uri: value.cover }} style={{ width: size, height: size, borderRadius: round ? size / 2 : 7, backgroundColor: c.surface }} /> : <View style={{ width: size, height: size, borderRadius: round ? size / 2 : 7, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={round ? 'person' : 'musical-notes'} size={Math.min(48, size / 2)} color={c.secondary} /></View>;
  }
  function trackRow(track: CatalogItem) {
    return <View key={track.id} style={styles.track}><Pressable onPress={() => void play(track)} accessibilityLabel={'Riproduci ' + track.title} style={styles.trackMain}>{artwork(track, 48)}<View style={{ flex: 1 }}><Text numberOfLines={1} style={[styles.title, { color: c.text }]}>{track.title}{track.explicit ? ' 🅴' : ''}</Text><Text numberOfLines={1} style={[styles.subtitle, { color: c.secondary }]}>{[track.album || track.artist, year(track)].filter(Boolean).join(' · ')}</Text></View></Pressable><ServerDownloadBadge item={item.kind === 'album' ? { ...track, albumId: item.id } : track} /><Pressable onPress={() => setAction(item.kind === 'album' ? { ...track, albumId: item.id } : track)} accessibilityLabel={'Opzioni per ' + track.title} style={styles.more}><Ionicons name="ellipsis-horizontal" size={23} color={c.secondary} /></Pressable><View style={[styles.separator, { backgroundColor: c.border }]} /></View>;
  }
  function rail(title: string, items: CatalogItem[], round = false, onHeading?: () => void) {
    if (!items.length) return null;
    const size = round ? 102 : Math.min(184, width * 0.4);
    return <View>{heading(title, onHeading)}<FlatList horizontal data={items} keyExtractor={v => v.kind + v.id} showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }} renderItem={({ item: value }) => <View style={{ width: size }}><Pressable onPress={() => onOpen(value)} onLongPress={() => setAction(value)} accessibilityLabel={'Apri ' + value.title}>{artwork(value, size, round)}<Text numberOfLines={1} style={{ color: c.text, fontSize: 15, marginTop: 7, textAlign: round ? 'center' : 'left' }}>{value.title}</Text></Pressable>{!round && <View style={styles.railCaption}><Text numberOfLines={1} style={{ color: c.secondary, fontSize: 14, flex: 1 }}>{title === 'Collaborazioni' ? value.artist : year(value)}</Text><ServerDownloadBadge item={value} /><Pressable onPress={() => setAction(value)} accessibilityLabel={'Opzioni album ' + value.title} style={{ minWidth: 44, minHeight: 36, alignItems: 'flex-end', justifyContent: 'center' }}><Ionicons name="ellipsis-horizontal" size={20} color={c.secondary} /></Pressable></View>}</View>} /></View>;
  }
  const artistHeader = <>
    <View style={{ height: insets.top + Math.max(342, Math.min(510, width * 0.92)), backgroundColor: c.surface }}>
      {!!current.cover && <Image source={{ uri: current.cover }} style={StyleSheet.absoluteFill} resizeMode="cover" />}
      <LinearGradient pointerEvents="none" colors={['transparent', isDark ? '#00000099' : '#ffffffbb', c.background]} locations={[0.22, 0.65, 1]} style={StyleSheet.absoluteFill} />
      <View style={styles.heroFooter}><Text numberOfLines={2} style={{ color: c.text, fontSize: 34, fontWeight: '800', textAlign: 'center', marginHorizontal: 20 }}>{current.title}</Text><View style={styles.heroControls}>
        {circle('information', 'Informazioni artista', () => setInfo(true))}
        <Pressable disabled={playBusy || !profile?.topTracks.some(t => t.available || t.libraryMatch)} onPress={() => void play(profile?.topTracks ?? [])} accessibilityLabel={'Riproduci i top brani di ' + current.title} style={[styles.heroPlay, { backgroundColor: c.text, opacity: profile?.topTracks.length ? 1 : 0.45 }]}><Ionicons name="play" size={39} color={c.background} style={{ marginLeft: 4 }} /></Pressable>
        {circle(favorite ? 'star' : 'star-outline', favorite ? 'Rimuovi artista dai preferiti su questo dispositivo' : 'Salva artista nei preferiti su questo dispositivo', () => void toggleFavorite(), !favoriteReady || favoriteBusy)}
      </View></View>
    </View>
    {profile?.latestRelease && <View style={[styles.latest, { borderColor: c.border }]}><GlassBackground /><Pressable style={styles.latestMain} onPress={() => onOpen(profile.latestRelease!)} accessibilityLabel={'Apri ultima uscita ' + profile.latestRelease.title}>{artwork(profile.latestRelease, 94)}<View style={{ flex: 1 }}><Text style={[styles.subtitle, { color: c.secondary }]}>{profile.latestRelease.releaseDate || 'Ultima uscita'}</Text><Text numberOfLines={2} style={[styles.title, { color: c.text, fontWeight: '700', marginTop: 4 }]}>{profile.latestRelease.title}</Text>{!!profile.latestRelease.trackCount && <Text style={[styles.subtitle, { color: c.secondary, marginTop: 4 }]}>{profile.latestRelease.trackCount} brani</Text>}</View></Pressable><ServerDownloadBadge item={profile.latestRelease} /><Pressable onPress={() => setAction(profile.latestRelease!)} accessibilityLabel={'Opzioni e download ' + profile.latestRelease.title} style={[styles.more, { borderRadius: 23, backgroundColor: c.surface, marginRight: 10 }]}><Ionicons name={isServerComplete(profile.latestRelease) ? 'checkmark' : 'add'} size={25} color={c.text} /></Pressable></View>}
    {!!profile?.topTracks.length && <>{heading(allTracks ? 'Top brani · Mostra meno' : 'Top brani', () => setAllTracks(v => !v))}<View style={{ paddingHorizontal: 20 }}>{profile.topTracks.slice(0, allTracks ? 20 : 5).map(trackRow)}</View></>}
    {profile && !profile.topTracks.length && <Text style={[styles.note, { color: c.secondary }]}>Qobuz non ha fornito i top brani. Puoi ascoltare i brani aprendo un album.</Text>}
    {!!profile?.principalAlbums.length && <>{heading('Album principali', () => onAlbums(current, profile.albums))}<View style={{ paddingHorizontal: 20 }}>{profile.principalAlbums.map(value => <View key={value.id} style={[styles.principal, { borderColor: c.border }]}><Pressable onPress={() => onOpen(value)} style={styles.latestMain}>{artwork(value, 100)}<View style={{ flex: 1 }}><Text style={[styles.title, { color: c.text }]}>{value.title}</Text><Text style={[styles.subtitle, { color: c.secondary, marginTop: 5 }]}>{year(value)}</Text></View><ServerDownloadBadge item={value} /><Ionicons name="chevron-forward" size={21} color={c.secondary} /></Pressable></View>)}</View></>}
    {profile?.releases.map(group => <View key={group.id}>{rail(group.title, group.items, false, group.id === 'album' ? () => onAlbums(current, profile.albums) : undefined)}</View>)}
    {profile && rail('Artisti simili', profile.similarArtists, true)}
    {!!profile?.albums.items.length && heading('Tutta la discografia', () => onAlbums(current, profile.albums))}
    {!!profile?.artist.biography && <>{heading('Informazioni')}<Pressable onPress={() => setInfo(true)} style={{ paddingHorizontal: 20 }}><Text numberOfLines={4} style={{ color: c.secondary, fontSize: 16, lineHeight: 24 }}>{profile.artist.biography}</Text><Text style={{ color: c.accent, paddingTop: 8 }}>Leggi di più</Text></Pressable></>}
    {!!profile?.partial.length && <Pressable onPress={() => { loadedRevision.current = null; setRetry(v => v + 1); }}><Text style={[styles.note, { color: c.secondary }]}>Alcune informazioni Qobuz non sono disponibili. Tocca per riprovare.</Text></Pressable>}
  </>;
  const albumHeader = <View style={{ paddingTop: insets.top + 82, paddingHorizontal: 20, alignItems: 'center' }}>{artwork(current, Math.min(width - 100, 330))}<Text style={{ color: c.text, fontSize: 25, fontWeight: '700', textAlign: 'center', marginTop: 22 }}>{current.title}</Text><View style={{ marginTop: 10 }}><ServerDownloadBadge item={current} label /></View><Pressable disabled={!current.artistId} onPress={() => onOpen({ id: current.artistId!, kind: 'artist', title: current.artist, artist: current.artist, album: '', available: true })}><Text style={{ color: c.accent, fontSize: 19, marginTop: 6 }}>{current.artist}</Text></Pressable><Text style={[styles.subtitle, { color: c.secondary, marginTop: 8 }]}>{[current.genre, year(current), current.trackCount ? current.trackCount + ' brani' : ''].filter(Boolean).join(' · ')}</Text><View style={{ flexDirection: 'row', gap: 12, marginVertical: 24 }}><Pressable disabled={playBusy || !album?.items.some(t => t.available || t.libraryMatch)} onPress={() => void play(current)} style={[styles.albumPlay, { backgroundColor: c.surface }]}><Ionicons name="play" size={22} color={c.accent} /><Text style={{ color: c.accent, fontSize: 17, fontWeight: '600' }}>Riproduci</Text></Pressable><Pressable onPress={() => setAction(current)} style={[styles.albumPlay, { backgroundColor: c.surface }]}><Ionicons name={isServerComplete(current) ? 'checkmark-circle' : 'arrow-down-circle-outline'} size={23} color={c.accent} /><Text style={{ color: c.accent, fontSize: 17, fontWeight: '600' }}>Sul server</Text></Pressable></View></View>;
  function moreButton() { return <Pressable disabled={moreBusy} onPress={() => void more()} style={{ padding: 20 }}>{moreBusy ? <ActivityIndicator color={c.accent} /> : <Text style={{ color: c.accent, fontSize: 16 }}>Mostra altri</Text>}</Pressable>; }
  return <Animated.View style={[styles.fill, { backgroundColor: c.background, opacity: entrance, transform: [{ translateX: entrance.interpolate({ inputRange: [0, 1], outputRange: [reduceMotion ? 0 : 18, 0] }) }] }]}>
    <Animated.FlatList data={item.kind === 'album' ? album?.items ?? [] : []} keyExtractor={v => v.id} renderItem={({ item: track }) => <View style={{ paddingHorizontal: 20 }}>{trackRow(track)}</View>} showsVerticalScrollIndicator={false} contentInsetAdjustmentBehavior="never" automaticallyAdjustContentInsets={false} contentContainerStyle={{ paddingBottom: 200 }} onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: position } } }], { useNativeDriver: true, listener: onScroll })} scrollEventThrottle={16} ListHeaderComponent={<>{item.kind === 'artist' ? artistHeader : albumHeader}{loading && <ActivityIndicator color={c.accent} style={{ margin: 24 }} />}{!!error && <Pressable onPress={() => setRetry(v => v + 1)}><Text style={[styles.note, { color: c.accent }]}>{error} · Riprova</Text></Pressable>}</>} ListFooterComponent={item.kind === 'album' && album?.hasMore ? moreButton() : null} />
    <View pointerEvents="box-none" style={[styles.navigation, { paddingTop: insets.top + 10 }]}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: c.background, opacity: position.interpolate({ inputRange: [60, 190], outputRange: [0, 0.94], extrapolate: 'clamp' }) }]} />
      {circle('chevron-back', 'Indietro', onBack)}<View style={{ flex: 1 }} /><View style={[styles.pill, { borderColor: c.border }]}><GlassBackground /><Pressable onPress={() => share(current)} accessibilityLabel={'Condividi ' + current.title} style={styles.more}><Ionicons name="share-outline" size={27} color={c.text} /></Pressable><Pressable onPress={() => setAction(current)} accessibilityLabel={'Opzioni per ' + current.title} style={styles.more}><Ionicons name="ellipsis-horizontal" size={26} color={c.text} /></Pressable></View>
    </View>
    {action && <NetworkActions key={action.kind + action.id} item={action} onClose={() => setAction(null)} onPlay={action.kind === 'artist' ? undefined : () => void play(action)} onDownloaded={onDownloaded} />}
    {info && <Modal transparent animationType={reduceMotion ? 'none' : 'slide'} onRequestClose={() => setInfo(false)}><View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#0008' }}><Pressable onPress={() => setInfo(false)} accessibilityLabel="Chiudi informazioni" style={StyleSheet.absoluteFill} /><View style={{ maxHeight: '78%', padding: 24, paddingBottom: 44, borderTopLeftRadius: 32, borderTopRightRadius: 32, backgroundColor: c.background }}><View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 18 }}><Text style={{ color: c.text, fontSize: 26, fontWeight: '700', flex: 1 }}>{current.title}</Text>{circle('close', 'Chiudi informazioni', () => setInfo(false))}</View><ScrollView><Text selectable style={{ color: c.text, fontSize: 17, lineHeight: 26 }}>{profile?.artist.biography || 'Biografia non disponibile su Qobuz.'}</Text>{!!profile?.artist.biographySource && <Text style={{ color: c.secondary, marginTop: 20 }}>Fonte: {profile.artist.biographySource}</Text>}<Text style={{ color: c.secondary, marginTop: 20 }}>Catalogo Qobuz</Text></ScrollView></View></View></Modal>}
  </Animated.View>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 }, navigation: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 12 },
  circle: { width: 46, height: 46, borderRadius: 23, borderWidth: 0.5, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  pill: { flexDirection: 'row', borderRadius: 26, paddingHorizontal: 6, borderWidth: 0.5, overflow: 'hidden' },
  more: { width: 46, minHeight: 46, alignItems: 'center', justifyContent: 'center' },
  heroFooter: { position: 'absolute', bottom: 20, left: 0, right: 0 }, heroControls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24, marginTop: 16 },
  heroPlay: { width: 70, height: 70, borderRadius: 35, alignItems: 'center', justifyContent: 'center' },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 20, marginTop: 30, marginBottom: 16, minHeight: 30 },
  latest: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 20, marginTop: 10, borderRadius: 28, borderWidth: 0.5, overflow: 'hidden' },
  latestMain: { flex: 1, flexDirection: 'row', gap: 12, alignItems: 'center', padding: 11 },
  title: { fontSize: 17 }, subtitle: { fontSize: 15 }, track: { flexDirection: 'row', alignItems: 'center', minHeight: 55 },
  trackMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  separator: { position: 'absolute', bottom: 0, left: 60, right: 0, height: 0.5 },
  railCaption: { flexDirection: 'row', alignItems: 'center' }, principal: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 0.5, paddingVertical: 3 },
  albumPlay: { flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, minHeight: 48, borderRadius: 15 },
  note: { paddingHorizontal: 20, paddingVertical: 18, fontSize: 14, lineHeight: 21 },
});
