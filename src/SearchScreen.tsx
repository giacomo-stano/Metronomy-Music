import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Image, Keyboard, ScrollView, StyleSheet, Text, TextInput, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Pressable from './SpringPressable';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import { coverURL, request, accountStorageKey, currentAccount, isConnectivityFailure, type Album, type SearchResponse, type Song } from './api';
import { useTheme } from './theme';
import GlassBackground from './GlassBackground';
import Discover from './Discover';
import { DownloadBadge } from './OfflineDownloads';

type Item = { id: string; kind: 'track' | 'album'; title: string; artist: string; album: string; cover?: string; available: boolean; libraryMatch?: string };
type Job = { id: string; target: string; title: string; status: string; message: string };
type Catalog = { items: Item[]; hasMore: boolean; libraryChecked: boolean };
type Props = { onSettings: () => void; onPlay: (song: Song) => void; onAlbum: (album: Album) => void; onAlbumActions: (album: Album) => void; beforePreview: () => void; localPlaying: boolean; initialQuery: string; onActions: (song: Song) => void; onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void };
const label: Record<string, string> = { queued: 'In coda', downloading: 'Download in corso', completed: 'Già scaricato', failed: 'Non completato' };
const msg = (e: unknown) => isConnectivityFailure(e) ? 'Connessione non disponibile.' : e instanceof Error ? e.message : 'Connessione non riuscita';

export default function SearchScreen({ onSettings, onPlay, onAlbum, onAlbumActions, beforePreview, localPlaying, initialQuery, onActions, onScroll }: Props) {
  const { colors: c } = useTheme();
  const [query, setQuery] = useState(initialQuery);
  const [searchStorageKey] = useState(() => accountStorageKey('searches'));
  const targets = currentAccount()?.destinations ?? [];
  const [destination, setDestination] = useState(targets.length === 1 ? targets[0].id : '');
  const input = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  const [listening, setListening] = useState(false);
  const [speechError, setSpeechError] = useState('');
  const micScale = useRef(new Animated.Value(1)).current;
  const [scope, setScope] = useState<'qobuz' | 'library'>(initialQuery || currentAccount()?.offline ? 'library' : 'qobuz');
  const [kind, setKind] = useState<'track' | 'album'>('track');
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [local, setLocal] = useState<SearchResponse | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [jobError, setJobError] = useState('');
  const [pending, setPending] = useState('');
  const [reload, setReload] = useState(0);
  const [previewId, setPreviewId] = useState('');
  const [previewBusy, setPreviewBusy] = useState('');
  const preview = useAudioPlayer(null, { updateInterval: 250 });
  const previewStatus = useAudioPlayerStatus(preview);
  const generation = useRef(0);
  const previewGeneration = useRef(0);
  const recentTouched = useRef(false);
  const recentWrites = useRef(Promise.resolve());
  const alive = useRef(true);

  const restorePlaybackAudioMode = () =>
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    }).catch(() => {});

  useSpeechRecognitionEvent('start', () => {
    setListening(true);
    setSpeechError('');
  });

  useSpeechRecognitionEvent('result', event => {
    const transcript = event.results[0]?.transcript?.trim() ?? '';
    if (!transcript) return;

    setQuery(transcript);

    if (event.isFinal) {
      saveRecent([
        transcript,
        ...recent.filter(value => value !== transcript),
      ].slice(0, 10));
    }
  });

  useSpeechRecognitionEvent('volumechange', event => {
    const level = Math.max(0, Math.min(1, (event.value + 2) / 12));

    Animated.spring(micScale, {
      toValue: 1 + level * 0.18,
      stiffness: 320,
      damping: 20,
      mass: 0.5,
      useNativeDriver: true,
    }).start();
  });

  useSpeechRecognitionEvent('end', () => {
    setListening(false);
    void restorePlaybackAudioMode();

    Animated.spring(micScale, {
      toValue: 1,
      stiffness: 340,
      damping: 22,
      mass: 0.5,
      useNativeDriver: true,
    }).start();
  });

  useSpeechRecognitionEvent('error', event => {
    setListening(false);

    if (event.error === 'aborted') return;

    if (event.error === 'no-speech') {
      setSpeechError('Non ho sentito nulla. Tocca il microfono e riprova.');
      return;
    }

    if (
      event.error === 'not-allowed' ||
      event.error === 'service-not-allowed'
    ) {
      setSpeechError(
        'Consenti microfono e riconoscimento vocale nelle Impostazioni di iPhone.'
      );
      return;
    }

    if (event.error === 'network') {
      setSpeechError('La ricerca vocale non è disponibile senza connessione.');
      return;
    }

    setSpeechError('Ricerca vocale non disponibile. Riprova.');
  });
  useEffect(() => { alive.current = true; AsyncStorage.getItem(searchStorageKey).then(value => { if (alive.current && !recentTouched.current) { const parsed = JSON.parse(value || '[]'); if (Array.isArray(parsed)) setRecent(parsed.filter(v => typeof v === 'string').slice(0, 10)); } }).catch(() => {}); return () => { alive.current = false; previewGeneration.current++; try { ExpoSpeechRecognitionModule.abort(); } catch {} void restorePlaybackAudioMode(); }; }, []);
  function saveRecent(values: string[]) { recentTouched.current = true; setRecent(values); recentWrites.current = recentWrites.current.then(() => AsyncStorage.setItem(searchStorageKey, JSON.stringify(values))).catch(() => {}); }
  function remember() { if (query.trim()) saveRecent([query.trim(), ...recent.filter(q => q !== query.trim())].slice(0, 10)); }
  function stopPreview() { previewGeneration.current++; preview.pause(); setPreviewId(''); setPreviewBusy(''); }
  function closeSearch() {
    generation.current++;

    if (listening) {
      try {
        ExpoSpeechRecognitionModule.abort();
      } catch {}
    }

    stopPreview();
    setQuery('');
    setCatalog(null);
    setLocal(null);
    setError('');
    setSpeechError('');
    setBusy(false);
    setFocused(false);
    input.current?.blur();
    Keyboard.dismiss();
  }

  async function showDictation() {
    if (listening) {
      ExpoSpeechRecognitionModule.stop();
      return;
    }

    stopPreview();
    setSpeechError('');
    input.current?.blur();
    Keyboard.dismiss();

    try {
      if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
        setSpeechError(
          'Il riconoscimento vocale non è disponibile su questo iPhone.'
        );
        return;
      }

      const permission =
        await ExpoSpeechRecognitionModule.requestPermissionsAsync();

      if (!permission.granted) {
        setSpeechError(
          'Consenti microfono e riconoscimento vocale per cercare musica con la voce.'
        );
        return;
      }

      const offline = !!currentAccount()?.offline;
      const onDevice =
        offline &&
        ExpoSpeechRecognitionModule.supportsOnDeviceRecognition();

      if (offline && !onDevice) {
        setSpeechError(
          'La ricerca vocale offline non è supportata su questo iPhone.'
        );
        return;
      }

      beforePreview();

      ExpoSpeechRecognitionModule.start({
        lang: 'it-IT',
        interimResults: true,
        continuous: false,
        maxAlternatives: 1,
        iosTaskHint: 'search',
        requiresOnDeviceRecognition: onDevice,
        volumeChangeEventOptions: {
          enabled: true,
          intervalMillis: 120,
        },
      });
    } catch {
      setSpeechError('Impossibile avviare la ricerca vocale. Riprova.');
    }
  }
  useEffect(() => { if (localPlaying) stopPreview(); }, [localPlaying]);
  useEffect(() => { if (previewStatus.currentTime >= 30 || previewStatus.didJustFinish) { preview.pause(); setPreviewId(''); } }, [previewStatus.currentTime, previewStatus.didJustFinish]);
  useEffect(() => {
    let active = true; let timer: ReturnType<typeof setTimeout>;
    async function poll() { try { const data = await request<{ jobs: Job[] }>('network/downloads'); if (active) { setJobs(data.jobs); setJobError(''); } } catch (e) { if (active) setJobError(isConnectivityFailure(e) ? '' : msg(e)); } if (active) timer = setTimeout(poll, 5000); }
    void poll(); return () => { active = false; clearTimeout(timer); };
  }, []);
  useEffect(() => {
    const version = ++generation.current;
    stopPreview(); setCatalog(null); setLocal(null); setError(''); setBusy(!!query.trim() && !listening);
    const timer = setTimeout(async () => {
      if (!query.trim() || listening) return;
      try {
        if (scope === 'library') { const data = await request<SearchResponse>('search?q=' + encodeURIComponent(query.trim())); if (version === generation.current) setLocal(data); }
        else { const data = await request<Catalog>(`network/search?q=${encodeURIComponent(query.trim())}&kind=${kind}`, 100000); if (version === generation.current) setCatalog(data); }
      } catch (e) { if (version === generation.current) setError(isConnectivityFailure(e) ? '' : msg(e)); }
      finally { if (version === generation.current) setBusy(false); }
    }, 400);
    return () => { clearTimeout(timer); generation.current++; previewGeneration.current++; };
  }, [query, scope, kind, reload, listening]);
  async function more() {
    const version = generation.current; setBusy(true);
    try { const data = await request<Catalog>(`network/search?q=${encodeURIComponent(query.trim())}&kind=${kind}&offset=${catalog?.items.length ?? 0}`, 100000); if (version === generation.current) setCatalog(old => ({ ...data, items: [...(old?.items ?? []), ...data.items], libraryChecked: !!old?.libraryChecked && data.libraryChecked })); }
    catch (e) { if (version === generation.current) setError(isConnectivityFailure(e) ? '' : msg(e)); }
    finally { if (version === generation.current) setBusy(false); }
  }
  async function listen(item: Item) {
    remember();
    if (item.libraryMatch) {
      stopPreview();
      try { const data = await request<{ song: Song }>('songs/' + encodeURIComponent(item.libraryMatch)); if (alive.current) onPlay(data.song); } catch (e) { Alert.alert('Riproduzione', msg(e)); }
      return;
    }
    if (previewId === item.id) { stopPreview(); return; }
    stopPreview(); const version = ++previewGeneration.current; setPreviewBusy(item.id);
    try { const data = await request<{ url: string }>('network/preview/' + item.id, 35000); if (!alive.current || version !== previewGeneration.current) return; beforePreview(); preview.replace(data.url); preview.play(); setPreviewId(item.id); }
    catch (e) { if (alive.current && version === previewGeneration.current) Alert.alert('Anteprima', msg(e)); }
    finally { if (alive.current && version === previewGeneration.current) setPreviewBusy(''); }
  }
  async function download(item: Item) {
    if (!destination) { Alert.alert('Destinazione', 'Scegli Giacomo oppure Lorenza prima di scaricare.'); return; }
    setPending(item.id); remember();
    try { const job = await request<Job>('network/downloads', 100000, { kind: item.kind, id: item.id, destination }); if (alive.current) setJobs(old => [job, ...old.filter(j => j.id !== job.id)]); }
    catch (e) { Alert.alert('Download', msg(e)); }
    finally { if (alive.current) setPending(''); }
  }
  const text = { color: c.text, fontSize: 16 };
  const sub = { color: c.secondary, fontSize: 13, marginTop: 4 };
  const row = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, paddingVertical: 14, borderBottomWidth: 0.5, borderColor: c.border };
  const art = (url?: string) => url ? <Image source={{ uri: url }} style={{ width: 54, height: 54, borderRadius: 8 }} /> : <View style={{ width: 54, height: 54, backgroundColor: c.surface, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="musical-note" color={c.secondary} size={24} /></View>;
  return <View style={{ flex: 1 }}><View style={{ padding: 20, paddingBottom: 4 }}>
    {!focused && !listening && <View style={row}><Text style={{ color: c.text, fontSize: 36, fontWeight: '800', flex: 1 }}>Cerca</Text><Pressable onPress={onSettings} accessibilityLabel="Apri impostazioni"><Ionicons name="person-circle-outline" size={38} color={c.accent} /></Pressable></View>}
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 }}>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', borderRadius: 28, borderWidth: 0.5, borderColor: c.border, overflow: 'hidden', paddingLeft: 15, minHeight: 54 }}>
        <GlassBackground /><Ionicons name={listening ? "mic-outline" : "search"} size={23} color={listening ? c.accent : c.text} />
        <TextInput ref={input} style={{ ...text, paddingVertical: 14, paddingHorizontal: 10, flex: 1, minWidth: 0 }} placeholder={listening ? "Ascolto…" : "Artisti, brani e album"} placeholderTextColor={c.secondary} value={query} onChangeText={setQuery} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onSubmitEditing={() => { remember(); Keyboard.dismiss(); }} returnKeyType="search" autoCorrect={false} autoCapitalize="none" accessibilityLabel="Cerca musica" maxLength={200} selectionColor={c.accent} />
        <Pressable onPress={() => void showDictation()} accessibilityRole="button" accessibilityLabel={listening ? "Termina ricerca vocale" : "Avvia ricerca vocale"} accessibilityHint={listening ? "Termina l’ascolto e usa il testo riconosciuto" : "Ascolta la tua voce e cerca musica"} style={{ width: 44, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}><Animated.View style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: listening ? c.accent : 'transparent', transform: [{ scale: micScale }] }}><Ionicons name={listening ? "mic" : "mic-outline"} color={listening ? "#fff" : c.text} size={23} /></Animated.View></Pressable>
      </View>
      {(focused || !!query || listening) && <Pressable onPress={closeSearch} accessibilityRole="button" accessibilityLabel="Chiudi e cancella ricerca" style={{ width: 54, height: 54, borderRadius: 27, overflow: 'hidden', borderWidth: 0.5, borderColor: c.border, alignItems: 'center', justifyContent: 'center' }}><GlassBackground /><Ionicons name="close" color={c.text} size={32} /></Pressable>}
    </View>
    {listening && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 9, paddingHorizontal: 8 }}><Animated.View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.accent, transform: [{ scale: micScale }] }} /><Text accessibilityLiveRegion="polite" style={{ color: c.secondary, fontSize: 12 }}>Ascolto… parla ora</Text></View>}
    {!!speechError && !listening && <Text accessibilityLiveRegion="polite" style={{ color: c.secondary, fontSize: 12, marginTop: 9, paddingHorizontal: 8 }}>{speechError}</Text>}
    <View style={{ flexDirection: 'row', borderRadius: 24, backgroundColor: c.surface, padding: 4, marginTop: 12 }}>{(['qobuz', 'library'] as const).map(value => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: scope === value }} onPress={() => value === 'qobuz' && currentAccount()?.offline ? Alert.alert('Qobuz richiede internet', 'Accedi online per cercare nel catalogo Qobuz.') : setScope(value)} style={{ flex: 1, padding: 10, alignItems: 'center', borderRadius: 20, backgroundColor: scope === value ? c.background : 'transparent' }}><Text style={text}>{value === 'qobuz' ? 'Qobuz' : 'Libreria'}</Text></Pressable>)}</View>
  </View><ScrollView onScroll={onScroll} scrollEventThrottle={32} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingBottom: 200 }}>
    {scope === 'qobuz' && !!query.trim() && <View style={{ paddingBottom: 16 }}><Text style={sub}>Scarica nella libreria: {targets.length === 1 ? targets[0].label : 'scegli la destinazione'}</Text>{targets.length > 1 && <View style={{ flexDirection: 'row', gap: 12, marginTop: 10 }}>{targets.map(target => <Pressable key={target.id} accessibilityRole="radio" accessibilityState={{ checked: destination === target.id }} onPress={() => setDestination(target.id)} style={{ borderRadius: 18, padding: 12, backgroundColor: c.surface }}><Text style={{ color: destination === target.id ? c.accent : c.secondary }}>{destination === target.id ? '✓ ' : ''}{target.label}</Text></Pressable>)}</View>}</View>}
    {!query.trim() && focused && !listening && <><View style={row}><Text style={{ ...text, flex: 1, fontWeight: '700', fontSize: 22 }}>Ricerche recenti</Text><Pressable onPress={() => saveRecent([])} accessibilityLabel="Cancella ricerche recenti"><Text style={{ color: c.accent }}>Cancella</Text></Pressable></View>{recent.map(value => <Pressable key={value} onPress={() => setQuery(value)} style={row}><Ionicons name="time-outline" size={23} color={c.secondary} /><Text style={{ ...text, flex: 1 }}>{value}</Text><Ionicons name="chevron-forward" color={c.secondary} size={18} /></Pressable>)}{!recent.length && <Text style={sub}>Le ricerche selezionate o confermate appariranno qui.</Text>}</>}
    {!query.trim() && !focused && !listening && <Discover scope={scope} onAlbum={onAlbum} onQuery={value => { setKind('album'); setQuery(value); }} />}
    {scope === 'qobuz' && !!query.trim() && <View style={{ flexDirection: 'row', gap: 12, marginBottom: 10 }}>{(['track', 'album'] as const).map(value => <Pressable key={value} onPress={() => setKind(value)} style={{ padding: 10, borderRadius: 18, backgroundColor: kind === value ? c.surface : 'transparent' }}><Text style={{ color: kind === value ? c.accent : c.secondary }}>{value === 'track' ? 'Brani' : 'Album'}</Text></Pressable>)}</View>}
    {!!error && <Pressable onPress={() => setReload(v => v + 1)}><Text style={{ color: c.accent }}>{error} · Riprova</Text></Pressable>}
    {catalog && !catalog.libraryChecked && <Text style={{ color: c.accent }}>Verifica libreria non disponibile: download temporaneamente bloccati.</Text>}
    {catalog?.items.map((item, i) => {
      const job = jobs.find(j => j.target === item.kind + ':' + item.id);
      const exists = !!item.libraryMatch || job?.status === 'completed';
      const blocked = !!pending || !catalog.libraryChecked || !item.available || job?.status === 'queued' || job?.status === 'downloading';
      return <View key={item.id + ':' + i} style={row}>{art(item.cover)}<View style={{ flex: 1 }}><Text numberOfLines={2} style={text}>{item.title}</Text><Text numberOfLines={1} style={sub}>{item.artist}</Text>{exists && <Text style={{ color: c.accent, fontSize: 12, marginTop: 4 }}>{item.libraryMatch ? 'Già in libreria' : 'Già scaricato sul server'}</Text>}{job && !exists && <Text style={sub}>{label[job.status]}</Text>}{item.kind === 'track' && <Pressable disabled={!!previewBusy} onPress={() => void listen(item)} style={{ paddingVertical: 9 }}><Text style={{ color: c.accent }}>{previewBusy === item.id ? 'Caricamento…' : item.libraryMatch ? '▶ Ascolta dalla libreria' : previewId === item.id ? '■ Ferma anteprima' : '▶ Anteprima · fino a 30 s'}</Text></Pressable>}</View><Pressable accessibilityLabel={exists ? 'Già in libreria' : 'Scarica ' + item.title} disabled={!exists && blocked} style={{ padding: 10, opacity: !exists && blocked ? 0.3 : 1 }} onPress={() => exists ? Alert.alert('Già presente', 'Non occorre riscaricarlo. Controlla la tua Libreria.') : Alert.alert('Scarica sul server', item.title + (item.kind === 'album' ? '\nVerrà controllato l’intero album per evitare duplicati.' : ''), [{ text: 'Annulla', style: 'cancel' }, { text: 'Scarica', onPress: () => void download(item) }])}><Ionicons name={exists ? 'checkmark-circle' : 'arrow-down-circle-outline'} size={27} color={c.accent} /></Pressable></View>;
    })}
    {local?.albums.map(album => <View key={'album:' + album.id} style={row}><Pressable style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 }} onPress={() => { remember(); stopPreview(); onAlbum(album); }}>{art(coverURL(album.coverArt))}<View style={{ flex: 1 }}><Text style={text}>{album.name}</Text><Text style={sub}>{album.artist} · Album</Text></View></Pressable><Pressable onPress={() => onAlbumActions(album)} accessibilityLabel={'Opzioni album ' + album.name} style={{ padding: 12 }}><Ionicons name="ellipsis-horizontal" size={24} color={c.secondary} /></Pressable></View>)}
    {local?.songs.map(song => <View key={song.id} style={row}><Pressable style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 }} onPress={() => { remember(); stopPreview(); onPlay(song); }}>{art(coverURL(song.coverArt))}<View style={{ flex: 1 }}><Text style={text}>{song.title}</Text><Text style={sub}>{song.artist} · Brano</Text></View></Pressable><DownloadBadge song={song} /><Pressable accessibilityLabel={'Opzioni per ' + song.title} style={{ padding: 12 }} onPress={() => onActions(song)}><Ionicons name="ellipsis-horizontal" size={24} color={c.secondary} /></Pressable></View>)}
    {busy && <ActivityIndicator color={c.accent} style={{ margin: 24 }} />}
    {!busy && ((catalog && !catalog.items.length) || (local && !local.songs.length && !local.albums.length)) && <Text style={sub}>Nessun risultato.</Text>}
    {catalog?.hasMore && <Pressable disabled={busy} onPress={() => void more()} style={{ padding: 16 }}><Text style={{ color: c.accent }}>Altri risultati</Text></Pressable>}
    {scope === 'qobuz' && !!query.trim() && <><Text style={{ ...text, fontSize: 22, fontWeight: '700', marginTop: 30 }}>Download sul server</Text>{!!jobError && <Text style={sub}>{jobError}</Text>}{jobs.slice(0, 12).map(job => <View key={job.id} style={{ paddingVertical: 12 }}><Text style={text}>{job.title}</Text><Text style={sub}>{label[job.status]}{job.message ? ' · ' + job.message : ''}</Text></View>)}{!jobs.length && <Text style={sub}>Nessun download. I file vengono salvati sul server, non sull’iPhone.</Text>}</>}
  </ScrollView></View>;
}
