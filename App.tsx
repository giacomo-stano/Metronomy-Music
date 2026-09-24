import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { ActivityIndicator, Alert, Animated, AppState, Easing, Image, PanResponder, SafeAreaView, ScrollView, Share, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { coverURL, streamURL, request, type Album, type HomeResponse, type Song, type SearchResponse, type Lyrics } from './src/api';
import SearchScreen from './src/SearchScreen';
import PlayerSheet from './src/PlayerSheet';
import { Ionicons } from '@expo/vector-icons';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { GlassView } from 'expo-glass-effect';
import { LinearGradient } from 'expo-linear-gradient';
import GlassBackground from './src/GlassBackground';
import LibraryScreen from './src/LibraryScreen';
import SongActions from './src/SongActions';
import AlbumActions from './src/AlbumActions';
import { usePlaybackSignals } from './src/usePlaybackSignals';
import { useMiniMotion } from './src/useMiniMotion';
import { ThemeProvider, useTheme, type Palette } from './src/theme';
import SettingsScreen from './src/SettingsScreen';
import LoginScreen from './src/LoginScreen';
import { accountStorageKey, configureAccount, onSessionExpired, endSession, probeAccount, probeConnectivity, isConnectivityFailure, type Account } from './src/api';
import { rememberAlbum } from './src/listeningHistory';
import { offlineAccount, offlineProfiles } from './src/offlineProfiles';
import { OfflineProvider, useOffline, DownloadBadge } from './src/OfflineDownloads';
import { clearAlbumSongsCache, peekAlbumSongs, preloadAlbumSongs } from './src/albumPrefetch';
import NowPlayingWaves from './src/NowPlayingWaves';
import ElasticPlayPauseButton from './src/ElasticPlayPauseButton';
import { migrateBrandData } from './src/brandMigration';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { addRemoteNextListener, addRemotePreviousListener, setRemoteControlsEnabled } from './modules/metronomy-audio-controls';
import { hapticLight, hapticSelection } from './src/haptics';

type Tab = 'Home' | 'Novità' | 'Libreria' | 'Cerca';

type AlbumOpenOrigin = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const tabs: { name: Tab; icon: SFSymbol; size: number }[] = [
  // Apple Music keeps these glyphs filled; selection is communicated mainly by tint/glass.
  { name: 'Home', icon: 'house.fill', size: 22 },
  { name: 'Novità', icon: 'square.grid.2x2.fill', size: 21 },
  // Library is rendered below with a custom Apple-Music-like stacked-card + note glyph.
  { name: 'Libreria', icon: 'music.note', size: 21 },
  { name: 'Cerca', icon: 'magnifyingglass', size: 22 },
];

const message = (e: unknown) => isConnectivityFailure(e) ? 'Connessione non disponibile.' : e instanceof Error ? e.message : 'Connessione non riuscita.';
const clock = (n: number) => { const t = Math.max(0, Math.floor(n || 0)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };

export default function App() {
  const [migration, setMigration] = useState<'loading' | 'ready' | 'error'>('loading');
  const [migrationError, setMigrationError] = useState('');
  const [migrationRetry, setMigrationRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setMigration('loading');
    migrateBrandData().then(() => { if (active) setMigration('ready'); }).catch(e => { if (active) { setMigrationError(e.message); setMigration('error'); } });
    return () => { active = false; };
  }, [migrationRetry]);
  if (migration !== 'ready') return <SafeAreaView style={{ flex: 1, backgroundColor: '#111', justifyContent: 'center', padding: 28 }}><Text style={{ color: '#fff', fontSize: 30, fontWeight: '700', marginBottom: 20 }}>Metronomy</Text>{migration === 'loading' ? <ActivityIndicator color="#ff375f" /> : <><Text style={{ color: '#fff', marginBottom: 20 }}>{migrationError}</Text><Text accessibilityRole="button" onPress={() => setMigrationRetry(v => v + 1)} style={{ color: '#ff375f', paddingVertical: 16 }}>Riprova migrazione</Text></>}</SafeAreaView>;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <AccountGate />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
const ACCOUNT_STORAGE_KEY = 'metronomy.activeAccount.v1';

type PersistedPlayerState = {
  song: Song;
  position: number;
};

function AccountGate() {
  const [account, setAccount] = useState<Account | null>(null);
  const [accountReady, setAccountReady] = useState(false);

  function clear() {
    configureAccount(null);
    setAccount(null);
    void AsyncStorage.removeItem(ACCOUNT_STORAGE_KEY).catch(() => {});
  }

  useEffect(() => {
    let active = true;

    void AsyncStorage.getItem(ACCOUNT_STORAGE_KEY)
      .then(raw => {
        if (!active || !raw) return;

        const saved = JSON.parse(raw) as Account;
        const valid =
          !!saved &&
          typeof saved.baseURL === 'string' &&
          typeof saved.username === 'string' &&
          typeof saved.token === 'string' &&
          Number.isFinite(saved.expires) &&
          saved.expires * 1000 > Date.now();

        if (!valid) {
          void AsyncStorage.removeItem(ACCOUNT_STORAGE_KEY).catch(() => {});
          return;
        }

        configureAccount(saved);
        setAccount(saved);
      })
      .catch(() => {
        void AsyncStorage.removeItem(ACCOUNT_STORAGE_KEY).catch(() => {});
      })
      .finally(() => {
        if (active) setAccountReady(true);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    onSessionExpired(clear);
    return () => onSessionExpired();
  }, []);

  useEffect(() => {
    // La sessione offline non deve scadere in base al token del server.
    if (!account || account.offline) return;

    const timer = setTimeout(
      clear,
      Math.max(0, account.expires * 1000 - Date.now())
    );

    return () => clearTimeout(timer);
  }, [account]);

  function enter(value: Account) {
    configureAccount(value);
    setAccount(value);

    if (!value.offline) {
      void AsyncStorage.setItem(
        ACCOUNT_STORAGE_KEY,
        JSON.stringify(value)
      ).catch(() => {});
    }
  }

  async function enterOfflineForCurrentAccount(): Promise<boolean> {
    const active = account;

    if (!active || active.offline) return false;

    try {
      const profiles = await offlineProfiles();
      const profile = profiles.find(
        value =>
          value.baseURL === active.baseURL &&
          value.username === active.username
      );

      if (!profile) return false;

      enter(offlineAccount(profile));
      return true;
    } catch {
      return false;
    }
  }

  async function restoreOnlineForCurrentAccount(): Promise<boolean> {
    const active = account;

    if (!active?.offline) return false;

    try {
      const raw = await AsyncStorage.getItem(ACCOUNT_STORAGE_KEY);
      if (!raw) return false;

      const saved = JSON.parse(raw) as Account;
      const valid =
        !!saved &&
        !saved.offline &&
        saved.baseURL === active.baseURL &&
        saved.username === active.username &&
        typeof saved.token === 'string' &&
        Number.isFinite(saved.expires) &&
        saved.expires * 1000 > Date.now();

      if (!valid) return false;
      if (!(await probeAccount(saved, 4500))) return false;

      configureAccount(saved);
      setAccount(saved);
      return true;
    } catch {
      return false;
    }
  }

  useEffect(() => {
    if (!account) return;

    let active = true;
    let checking = false;

    const checkOfflineReconnect = async () => {
      if (!active || checking || !account.offline) return;

      checking = true;
      try {
        await restoreOnlineForCurrentAccount();
      } finally {
        checking = false;
      }
    };

    const checkOnlineReachability = async () => {
      if (!active || checking || account.offline) return;

      checking = true;

      try {
        const reachable = await probeConnectivity(account, 1800);
        if (!active || reachable) return;

        // Repeat once before changing mode so a single transient packet loss
        // never throws the whole UI into offline mode.
        await new Promise(resolve => setTimeout(resolve, 250));
        if (!active) return;

        const confirmed = await probeConnectivity(account, 2200);
        if (!active || confirmed) return;

        await enterOfflineForCurrentAccount();
      } finally {
        checking = false;
      }
    };

    const check = account.offline
      ? checkOfflineReconnect
      : checkOnlineReachability;

    if (account.offline) {
      void check();
    }

    const interval = setInterval(
      () => {
        void check();
      },
      account.offline ? 15000 : 4000
    );

    const subscription = AppState.addEventListener(
      'change',
      state => {
        if (state === 'active') {
          void check();
        }
      }
    );

    return () => {
      active = false;
      clearInterval(interval);
      subscription.remove();
    };
  }, [
    account?.offline,
    account?.baseURL,
    account?.username,
    account?.token,
  ]);

  function logout() {
    /*
     * endSession() chiude la sessione API senza dover passare null
     * ad expo-audio.
     */
    const pending = endSession();
    setAccount(null);
    void AsyncStorage.removeItem(ACCOUNT_STORAGE_KEY).catch(() => {});
    void pending.catch(() => {});
  }

  if (!accountReady) {
    return (
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: '#111',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ActivityIndicator color="#ff375f" />
      </SafeAreaView>
    );
  }

  return account ? (
    <OfflineProvider
      key={account.baseURL + ':' + account.username}
    >
      <MusicApp
        account={account}
        onLogout={() => void logout()}
        onOffline={enterOfflineForCurrentAccount}
      />
    </OfflineProvider>
  ) : (
    <LoginScreen onLogin={enter} />
  );
}

function MusicApp({
  account,
  onLogout,
  onOffline,
}: {
  account: Account;
  onLogout: () => void;
  onOffline: () => Promise<boolean>;
}) {
  const { colors: c, isDark } = useTheme();
  const offlineContext = useOffline('library') as ReturnType<typeof useOffline> & {
    lyricsFor?: (songId: string) => Promise<{
      lyrics: Lyrics[];
      source?: string;
      instrumental?: boolean;
    }>;
  };
  const offlineStore = offlineContext.store as typeof offlineContext.store & {
    lyricsFor?: (songId: string) => Promise<{
      lyrics: Lyrics[];
      source?: string;
      instrumental?: boolean;
    }>;
  };
  const isOffline = !!account.offline;
  const playerStateKey = useMemo(
    () => accountStorageKey('player.v1'),
    [account.baseURL, account.username]
  );
  const s = useMemo(() => makeStyles(c), [c]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const previousOffline = useRef(isOffline);
  const [connectivityBanner, setConnectivityBanner] = useState<
    'offline' | 'online' | null
  >(null);
  const connectivityBannerScale = useRef(new Animated.Value(0.82)).current;
  const connectivityBannerOpacity = useRef(new Animated.Value(0)).current;
  const connectivityBannerY = useRef(new Animated.Value(-8)).current;
  const connectivityBannerAnimation =
    useRef<Animated.CompositeAnimation | null>(null);
  const [currentArtworkUri, setCurrentArtworkUri] = useState<
    string | undefined
  >(undefined);
  const [actionSong, setActionSong] = useState<Song | null>(null);
  const [actionAlbum, setActionAlbum] = useState<Album | null>(null);
  const [tab, setTab] = useState<Tab>('Home');
  const mountedTabs = useRef<Set<Tab>>(new Set(['Home']));
  mountedTabs.current.add(tab);
  const [home, setHome] = useState<HomeResponse | null>(null);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const catalogOpacity = useRef(new Animated.Value(1)).current;
  const catalogTransition =
    useRef<Animated.CompositeAnimation | null>(null);
  const [album, setAlbum] = useState<Album | null>(null);
  const [albumSongs, setAlbumSongs] = useState<Song[]>([]);
  const [albumOrigin, setAlbumOrigin] = useState<AlbumOpenOrigin | null>(null);
  const albumOpenProgress = useRef(new Animated.Value(0)).current;
  const albumCloseOpacity = useRef(new Animated.Value(1)).current;
  const albumClosing = useRef(false);
  const albumOpenAnimation = useRef<Animated.CompositeAnimation | null>(null);
  const albumCloseAnimation = useRef<Animated.CompositeAnimation | null>(null);
  const albumOpenFrame = useRef<number | null>(null);
  const [albumMotionDone, setAlbumMotionDone] = useState(false);

  useEffect(() => {
    const wasOffline = previousOffline.current;
    previousOffline.current = isOffline;

    if (wasOffline === isOffline) return;

    const kind = isOffline ? 'offline' : 'online';

    setReload(value => value + 1);

    connectivityBannerAnimation.current?.stop();
    connectivityBannerScale.stopAnimation();
    connectivityBannerOpacity.stopAnimation();
    connectivityBannerY.stopAnimation();

    connectivityBannerScale.setValue(0.82);
    connectivityBannerOpacity.setValue(0);
    connectivityBannerY.setValue(-8);
    setConnectivityBanner(kind);

    const animation = Animated.sequence([
      Animated.parallel([
        Animated.spring(connectivityBannerScale, {
          toValue: 1.05,
          stiffness: 360,
          damping: 18,
          mass: 0.62,
          overshootClamping: false,
          restDisplacementThreshold: 0.001,
          restSpeedThreshold: 0.001,
          useNativeDriver: true,
        }),
        Animated.timing(connectivityBannerOpacity, {
          toValue: 1,
          duration: 150,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.spring(connectivityBannerY, {
          toValue: 0,
          stiffness: 320,
          damping: 21,
          mass: 0.62,
          useNativeDriver: true,
        }),
      ]),
      Animated.spring(connectivityBannerScale, {
        toValue: 1,
        stiffness: 420,
        damping: 20,
        mass: 0.48,
        useNativeDriver: true,
      }),
      Animated.delay(2300),
      Animated.parallel([
        Animated.timing(connectivityBannerScale, {
          toValue: 0.88,
          duration: 180,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(connectivityBannerOpacity, {
          toValue: 0,
          duration: 180,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(connectivityBannerY, {
          toValue: -6,
          duration: 180,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    ]);

    connectivityBannerAnimation.current = animation;

    animation.start(({ finished }) => {
      if (connectivityBannerAnimation.current === animation) {
        connectivityBannerAnimation.current = null;
      }

      if (finished) {
        setConnectivityBanner(null);
      }
    });

    return () => {
      animation.stop();
    };
  }, [
    isOffline,
    connectivityBannerOpacity,
    connectivityBannerScale,
    connectivityBannerY,
  ]);

  const safeAreaRef = useRef<any>(null);
  const safeAreaMetrics = useRef({ x: 0, y: 0, width: 0, height: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [queue, setQueue] = useState<Song[]>([]);
  const [index, setIndex] = useState(-1);
  const [expanded, setExpanded] = useState(false);
  const audioReady = useRef<Promise<void> | null>(null);
  const audioGeneration = useRef(0);
  const remembered = useRef('');
  const [repeat, setRepeat] = useState<'off' | 'all' | 'one'>('off');
  const [shuffle, setShuffle] = useState(false);
  const [sleepMinutes, setSleepMinutes] = useState(0);
  const sleepTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [lyrics, setLyrics] = useState<Lyrics | null>(null);
  const [lyricsMessage, setLyricsMessage] = useState('');
  const [lyricsSource, setLyricsSource] = useState('');
  const [reload, setReload] = useState(0);
  const generation = useRef(0);
  const catalogLoadKeys = useRef<Record<'Home' | 'Novità', string>>({
    Home: '',
    Novità: '',
  });
  const player = useAudioPlayer(null, { updateInterval: 250 });
  const status = usePlaybackSignals(player);
  const current = queue[index];

  useEffect(() => {
    if (!current?.coverArt || isOffline) return;

    const uri = coverURL(current.coverArt);

    if (uri) {
      setCurrentArtworkUri(uri);
      void Image.prefetch(uri).catch(() => {});
    }
  }, [current?.id, current?.coverArt, isOffline]);

  const playback = useRef({ queue, index });
  const lastKnownPosition = useRef(0);
  playback.current = { queue, index };

  function persistPlayerState(
    song: Song,
    position: number
  ) {
    const safePosition =
      Number.isFinite(position) && position > 0
        ? position
        : 0;

    return AsyncStorage.setItem(
      playerStateKey,
      JSON.stringify({
        song,
        position: safePosition,
      } satisfies PersistedPlayerState)
    ).catch(() => {});
  }

  useEffect(() => {
    const updatePosition = (nextStatus: typeof player.currentStatus) => {
      if (
        Number.isFinite(nextStatus.currentTime) &&
        nextStatus.currentTime >= 0
      ) {
        lastKnownPosition.current = nextStatus.currentTime;
      }
    };

    const subscription = player.addListener(
      'playbackStatusUpdate',
      updatePosition
    );

    return () => {
      subscription.remove();
    };
  }, [player]);

  // Keep the artwork required by the player already decoded/cached.
  useEffect(() => {
    const candidates = queue
      .slice(Math.max(0, index), Math.max(0, index) + 6)
      .map(song => coverURL(song.coverArt))
      .filter((value): value is string => !!value);

    for (const uri of candidates) {
      void Image.prefetch(uri).catch(() => {});
    }
  }, [current?.id, index, queue]);
  function deleted(id: string) {
    deletedSongs([id]);
  }
  function deletedSongs(ids: string[]) {
    const now = playback.current;
    const selected = now.queue[now.index]?.id;
    const remaining = now.queue.filter(song => !ids.includes(song.id));
    if (selected && ids.includes(selected)) {
      player.pause();
      setExpanded(false);
      void AsyncStorage.removeItem(playerStateKey).catch(() => {});
    }
    setQueue(remaining); setIndex(remaining.findIndex(song => song.id === selected));
    setReload(n => n + 1);
  }
  const { width, height } = useWindowDimensions();
  const mini = useMiniMotion(tab + ':' + expanded, width + 80);

  // Elastic deformation of the whole mini-player capsule.
  const miniBubbleScaleX = useRef(new Animated.Value(1)).current;
  const miniBubbleScaleY = useRef(new Animated.Value(1)).current;
  const miniBubbleAnimation = useRef<Animated.CompositeAnimation | null>(null);

  function animateMiniPlayerBubble() {
    miniBubbleAnimation.current?.stop();

    miniBubbleScaleX.stopAnimation();
    miniBubbleScaleY.stopAnimation();

    const animation = Animated.sequence([
      Animated.parallel([
        Animated.timing(miniBubbleScaleX, {
          toValue: 0.972,
          duration: 78,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(miniBubbleScaleY, {
          toValue: 0.89,
          duration: 78,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.spring(miniBubbleScaleX, {
          toValue: 1,
          stiffness: 430,
          damping: 11,
          mass: 0.48,
          overshootClamping: false,
          restDisplacementThreshold: 0.001,
          restSpeedThreshold: 0.001,
          useNativeDriver: true,
        }),
        Animated.spring(miniBubbleScaleY, {
          toValue: 1,
          stiffness: 365,
          damping: 10,
          mass: 0.52,
          overshootClamping: false,
          restDisplacementThreshold: 0.001,
          restSpeedThreshold: 0.001,
          useNativeDriver: true,
        }),
      ]),
    ]);

    miniBubbleAnimation.current = animation;

    animation.start(() => {
      if (miniBubbleAnimation.current === animation) {
        miniBubbleAnimation.current = null;
      }
    });
  }

  function toggleFromMiniPlayer() {
    animateMiniPlayerBubble();
    toggle();
  }

  function updateSafeAreaMetrics(layoutWidth: number, layoutHeight: number) {
    safeAreaMetrics.current.width = layoutWidth;
    safeAreaMetrics.current.height = layoutHeight;

    requestAnimationFrame(() => {
      safeAreaRef.current?.measureInWindow?.(
        (x: number, y: number, measuredWidth: number, measuredHeight: number) => {
          safeAreaMetrics.current = {
            x,
            y,
            width: measuredWidth || layoutWidth,
            height: measuredHeight || layoutHeight,
          };
        }
      );
    });
  }

  function openAlbum(item: Album, origin?: AlbumOpenOrigin) {
    /*
     * Normalmente questo album è già stato scaldato mentre era visibile
     * nella griglia. onPressIn è un secondo fallback, poi qui deduplichiamo
     * comunque la stessa request tramite albumSongsRequests.
     */
    const cachedSongs = peekAlbumSongs(item.id);
    void preloadAlbumSongs(item.id, false, true).catch(() => {});

    albumOpenAnimation.current?.stop();
    albumCloseAnimation.current?.stop();

    setAlbumOrigin(origin ?? null);
    setAlbumSongs(cachedSongs ?? []);
    setError('');
    setBusy(false);
    setAlbumMotionDone(false);
    setAlbum(item);
  }

  useEffect(() => {
    albumOpenAnimation.current?.stop();
    albumCloseAnimation.current?.stop();

    if (albumOpenFrame.current !== null) {
      cancelAnimationFrame(albumOpenFrame.current);
      albumOpenFrame.current = null;
    }

    if (!album) {
      albumOpenProgress.setValue(0);
      albumCloseOpacity.setValue(1);
      albumClosing.current = false;
      setAlbumMotionDone(false);
      return;
    }

    albumClosing.current = false;
    setAlbumMotionDone(false);
    albumOpenProgress.setValue(0);
    albumCloseOpacity.setValue(1);

    albumOpenFrame.current = requestAnimationFrame(() => {
      albumOpenFrame.current = null;

      const animation = Animated.timing(albumOpenProgress, {
        toValue: 1,
        duration: 390,
        easing: Easing.bezier(0.22, 1, 0.36, 1),
        useNativeDriver: true,
        isInteraction: true,
      });

      albumOpenAnimation.current = animation;

      animation.start(({ finished }) => {
        if (albumOpenAnimation.current === animation) {
          albumOpenAnimation.current = null;
        }

        if (!finished) return;

        /*
         * La request parte prima dell'apertura. Se il preload ha già finito,
         * copiamo i brani nello state nello stesso callback in cui la cover
         * raggiunge scale = 1: non esiste un frame "album pronto ma vuoto".
         */
        const cachedSongs = peekAlbumSongs(album.id);
        if (cachedSongs) {
          setAlbumSongs(cachedSongs);
          setBusy(false);
        }

        setAlbumMotionDone(true);
      });
    });

    return () => {
      if (albumOpenFrame.current !== null) {
        cancelAnimationFrame(albumOpenFrame.current);
        albumOpenFrame.current = null;
      }

      albumOpenAnimation.current?.stop();
      albumOpenAnimation.current = null;
    };
  }, [album?.id, albumCloseOpacity, albumOpenProgress]);

  function closeAlbum() {
    if (!album || albumClosing.current) return;

    albumClosing.current = true;

    if (albumOpenFrame.current !== null) {
      cancelAnimationFrame(albumOpenFrame.current);
      albumOpenFrame.current = null;
    }

    albumOpenAnimation.current?.stop();
    albumOpenAnimation.current = null;
    albumCloseAnimation.current?.stop();

    const animation = Animated.parallel([
      Animated.timing(albumOpenProgress, {
        toValue: 0,
        duration: 320,
        easing: Easing.bezier(0.4, 0, 0.2, 1),
        useNativeDriver: true,
        isInteraction: true,
      }),
      /*
       * Dissolvenza rapida solo in chiusura: il movimento parte normalmente,
       * poi la pagina sfuma negli ultimi istanti invece di "rientrare" in modo
       * troppo evidente nella cover.
       */
      Animated.timing(albumCloseOpacity, {
        toValue: 0,
        duration: 145,
        delay: 85,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
        isInteraction: true,
      }),
    ]);

    albumCloseAnimation.current = animation;

    animation.start(({ finished }) => {
      if (albumCloseAnimation.current === animation) {
        albumCloseAnimation.current = null;
      }

      if (!finished) {
        albumCloseOpacity.setValue(1);
        albumClosing.current = false;
        return;
      }

      setAlbum(null);
      setAlbumOrigin(null);
      setAlbumSongs([]);
      albumClosing.current = false;
    });
  }

  function shuffleAlbum() {
    /*
     * Il pulsante dell'album abilita/disabilita soltanto la modalità casuale.
     * Non avvia la riproduzione e non apre il player.
     *
     * Quando l'utente lancerà poi un brano o l'album, next() userà già
     * questo stato per scegliere casualmente i brani successivi.
     */
    setShuffle(value => !value);
  }

  function downloadCurrentAlbum() {
    if (!albumSongs.length) return;

    if (isOffline) {
      Alert.alert('Download album', 'Accedi online per scaricare altri brani.');
      return;
    }

    const missing = albumSongs.filter(song => {
      if (offlineStore.tracks[song.id]) return false;
      const transfer = offlineStore.transfers[song.id];
      return !transfer || transfer.state === 'error';
    });

    if (!missing.length) {
      Alert.alert(
        'Download album',
        'Tutti i brani di questo album sono già disponibili su questo iPhone.'
      );
      return;
    }

    for (const song of missing) {
      void offlineStore.download(song).catch(() => {});
    }

    Alert.alert(
      'Download album',
      missing.length === 1
        ? '1 brano aggiunto ai download.'
        : `${missing.length} brani aggiunti ai download.`
    );
  }
  function browseSong(song: Song, type: 'album' | 'artist') {
    if (type === 'album' && song.albumId) openAlbum({ id: song.albumId, name: song.album ?? song.title, artist: song.artist, coverArt: song.coverArt });
    else { setAlbum(null); setQuery(type === 'artist' ? song.artist : song.album ?? song.title); setTab('Cerca'); }
  }

  useEffect(() => {
    audioReady.current = setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' });
    void audioReady.current.catch(() => Alert.alert('Audio', 'Impossibile configurare la sessione audio.'));
    return () => { audioGeneration.current++; };
  }, []);

  useEffect(() => {
    let active = true;
    const version = ++audioGeneration.current;

    const restore = async () => {
      try {
        const raw = await AsyncStorage.getItem(playerStateKey);

        if (!active || version !== audioGeneration.current || !raw) {
          return;
        }

        const saved = JSON.parse(raw) as Partial<PersistedPlayerState>;
        const song = saved.song;

        if (
          !song ||
          typeof song.id !== 'string' ||
          typeof song.title !== 'string' ||
          typeof song.artist !== 'string' ||
          typeof song.duration !== 'number'
        ) {
          void AsyncStorage.removeItem(playerStateKey).catch(() => {});
          return;
        }

        await audioReady.current;

        if (!active || version !== audioGeneration.current) {
          return;
        }

        const source = isOffline
          ? await offlineStore.source(song.id)
          : streamURL(song.id);

        if (
          !active ||
          version !== audioGeneration.current ||
          !source
        ) {
          return;
        }

        player.replace(source);

        if (
          typeof saved.position === 'number' &&
          Number.isFinite(saved.position) &&
          saved.position > 0
        ) {
          lastKnownPosition.current = saved.position;
          await player.seekTo(saved.position).catch(() => {});
        } else {
          lastKnownPosition.current = 0;
        }

        player.pause();

        if (!active || version !== audioGeneration.current) {
          return;
        }

        setQueue([song]);
        setIndex(0);

        const restoredArtwork = coverURL(song.coverArt);
        setCurrentArtworkUri(restoredArtwork);

        if (restoredArtwork) {
          void Image.prefetch(restoredArtwork).catch(() => {});
        }

        try {
          player.setActiveForLockScreen(
            true,
            {
              title: song.title,
              artist: song.artist,
              albumTitle: song.album,
              artworkUrl: coverURL(song.coverArt),
            },
            {
              showSeekBackward: false,
              showSeekForward: false,
            }
          );

          setRemoteControlsEnabled(true);
        } catch {
          /* Optional in Expo Go. */
        }
      } catch {
        if (active && version === audioGeneration.current) {
          void AsyncStorage.removeItem(playerStateKey).catch(() => {});
        }
      }
    };

    void restore();

    return () => {
      active = false;
    };
  }, [playerStateKey]);

  useEffect(() => {
    const saveCurrent = () => {
      const now = playback.current;
      const song = now.queue[now.index];

      if (song) {
        void persistPlayerState(
          song,
          lastKnownPosition.current
        );
      }
    };

    const subscription = AppState.addEventListener(
      'change',
      state => {
        if (state !== 'active') {
          saveCurrent();
        }
      }
    );

    return () => {
      subscription.remove();
      saveCurrent();
    };
  }, [playerStateKey, player]);

  useEffect(() => {
    if (current?.albumId && status.playing && status.listened && remembered.current !== current.id) {
      remembered.current = current.id;
      rememberAlbum({ id: current.albumId, name: current.album ?? current.title, artist: current.artist, coverArt: current.coverArt });
    }
  }, [current, status.playing, status.listened]);

  useEffect(() => {
    const version = ++generation.current;

    if ((tab === 'Cerca' || tab === 'Libreria') && !album) return;

    /*
     * The HTTP request for an album starts in openAlbum(), in parallel with
     * the transition. We wait only before mounting the list, not before I/O.
     */
    if (album) {
      if (!albumMotionDone) {
        setError('');
        setBusy(false);
        return;
      }

      setError('');
      setBusy(true);

      void preloadAlbumSongs(album.id)
        .then(songs => {
          if (generation.current === version) {
            setAlbumSongs(songs);
          }
        })
        .catch(e => {
          if (generation.current === version) {
            setError(message(e));
          }
        })
        .finally(() => {
          if (generation.current === version) {
            setBusy(false);
          }
        });

      return () => {
        generation.current++;
      };
    }

    const catalogLoadKey = `${reload}:${isOffline ? 'offline' : 'online'}`;

    if (
      tab === 'Home' &&
      home &&
      catalogLoadKeys.current.Home === catalogLoadKey
    ) {
      setError('');
      setBusy(false);
      return;
    }

    if (
      tab === 'Novità' &&
      albums.length > 0 &&
      catalogLoadKeys.current.Novità === catalogLoadKey
    ) {
      setError('');
      setBusy(false);
      return;
    }

    setError('');

    const hasVisibleCatalog =
      tab === 'Home'
        ? !!home
        : albums.length > 0;

    setBusy(!hasVisibleCatalog);
    setResults(null);

    const warmArtwork = async (items: { coverArt?: string }[]) => {
      const uris = items
        .map(item => coverURL(item.coverArt))
        .filter((uri): uri is string => !!uri)
        .slice(0, 14);

      if (!uris.length) return;

      await Promise.race([
        Promise.all(
          uris.map(uri => Image.prefetch(uri).catch(() => false))
        ),
        new Promise(resolve => setTimeout(resolve, 220)),
      ]);
    };

    const revealCatalog = (apply: () => void) => {
      catalogTransition.current?.stop();
      catalogOpacity.stopAnimation();
      catalogOpacity.setValue(0.86);

      apply();

      const animation = Animated.timing(catalogOpacity, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      });

      catalogTransition.current = animation;

      requestAnimationFrame(() => {
        animation.start(() => {
          if (catalogTransition.current === animation) {
            catalogTransition.current = null;
          }
        });
      });
    };

    const run = async () => {
      try {
        if (tab === 'Home') {
          const data = await request<HomeResponse>('home');

          await warmArtwork([
            ...data.recentAlbums,
            ...data.madeForYou,
          ]);

          if (generation.current === version) {
            catalogLoadKeys.current.Home = catalogLoadKey;
            revealCatalog(() => setHome(data));
          }
        } else if (tab === 'Cerca') {
          if (query.trim()) {
            const data = await request<SearchResponse>(
              'search?q=' + encodeURIComponent(query.trim())
            );
            if (generation.current === version) setResults(data);
          }
        } else {
          const data = await request<{
            albums: Album[];
            hasMore: boolean;
          }>(
            'albums?sort=' +
              (tab === 'Novità'
                ? 'newest'
                : 'alphabeticalByName')
          );

          await warmArtwork(data.albums);

          if (generation.current === version) {
            catalogLoadKeys.current.Novità = catalogLoadKey;
            revealCatalog(() => {
              setAlbums(data.albums);
              setHasMore(data.hasMore);
            });
          }
        }
      } catch (e) {
        if (generation.current === version) {
          if (!isOffline && isConnectivityFailure(e)) {
            const switched = await onOffline();

            if (!switched && generation.current === version) {
              setError('Nessuna connessione al server.');
            }

            return;
          }

          setError(message(e));
        }
      } finally {
        if (generation.current === version) {
          setBusy(false);
        }
      }
    };

    const timer = setTimeout(
      () => void run(),
      tab === 'Cerca' ? 350 : 0
    );

    return () => {
      clearTimeout(timer);
      generation.current++;
    };
  }, [tab, album, albumMotionDone, query, reload, isOffline]);

  useEffect(() => {
    clearAlbumSongsCache();
  }, [reload]);

  useEffect(() => {
    const unique = new Map<string, Album>();

    for (const item of home?.recentAlbums ?? []) {
      unique.set(item.id, item);
      if (unique.size >= 8) break;
    }

    if (unique.size < 8) {
      for (const item of albums) {
        unique.set(item.id, item);
        if (unique.size >= 8) break;
      }
    }

    for (const item of unique.values()) {
      void preloadAlbumSongs(item.id).catch(() => {});
    }
  }, [home, albums]);

  useEffect(() => {
    if (!current) return;

    let active = true;

    setLyrics(null);
    setLyricsSource('');
    setLyricsMessage('Caricamento testo…');

    type LyricsResult = {
      lyrics: Lyrics[];
      source?: string;
      instrumental?: boolean;
    };

    const localLyricsFor =
      offlineContext.lyricsFor ??
      offlineStore.lyricsFor;

    const load: Promise<LyricsResult> =
      isOffline
        ? localLyricsFor
          ? localLyricsFor(current.id)
          : Promise.resolve({
              lyrics: [],
              source: 'Offline',
              instrumental: false,
            })
        : request<LyricsResult>(
            'lyrics/' + encodeURIComponent(current.id),
            35000
          );

    load
      .then(data => {
        if (!active) return;

        const available = data.lyrics.filter(l => l.line?.length);

        setLyrics(
          available.find(l => l.synced) ??
          available[0] ??
          null
        );

        setLyricsSource(
          data.source ?? (isOffline ? 'Offline' : 'Navidrome')
        );

        setLyricsMessage(
          available.length
            ? ''
            : data.instrumental
              ? 'Brano indicato come strumentale da LRCLIB.'
              : isOffline
                ? 'Testo non disponibile offline.'
                : 'Nessun testo corrispondente trovato.'
        );
      })
      .catch(e => {
        if (active) setLyricsMessage(message(e));
      });

    return () => {
      active = false;
    };
  }, [current?.id, isOffline, offlineStore]);

  async function start(list: Song[], position: number, _open = false) {
    const next = list[position];
    if (!next) return;

    const version = ++audioGeneration.current;
    const previousQueue = queue;
    const previousIndex = index;
    const previousArtworkUri = currentArtworkUri;

    // Metadata first: title/artist/cover must react to the tap immediately.
    setQueue(list);
    setIndex(position);

    const artwork = coverURL(next.coverArt);
    setCurrentArtworkUri(artwork);

    if (artwork) {
      void Image.prefetch(artwork).catch(() => {});
    }

    try {
      await audioReady.current;
      if (version !== audioGeneration.current) return;

      /*
       * In modalità offline streamURL() non può essere usato: per scelta
       * api.ts genera un errore quando account.offline === true.
       *
       * Recuperiamo quindi direttamente il file locale verificato da
       * OfflineStore.source(). In modalità online continuiamo invece a usare
       * lo stream HTTP del bridge esattamente come prima.
       */
      const source = isOffline
        ? await offlineStore.source(next.id)
        : streamURL(next.id);

      if (version !== audioGeneration.current) return;

      if (!source) {
        throw new Error(
          'Il file di questo brano non è disponibile su questo iPhone.'
        );
      }

      player.replace(source);
      lastKnownPosition.current = 0;
      player.play();

      try {
        player.setActiveForLockScreen(
          true,
          {
            title: next.title,
            artist: next.artist,
            albumTitle: next.album,
            artworkUrl: coverURL(next.coverArt),
          },
          {
            showSeekBackward: false,
            showSeekForward: false,
          }
        );

        // expo-audio can update MPRemoteCommandCenter when activating
        // lock-screen controls. Re-enable our track commands afterwards.
        setRemoteControlsEnabled(true);
      } catch {
        /* Optional in Expo Go. */
      }

      void persistPlayerState(next, lastKnownPosition.current);
    } catch (e) {
      if (version === audioGeneration.current) {
        setQueue(previousQueue);
        setIndex(previousIndex);
        setCurrentArtworkUri(previousArtworkUri);
      }

      Alert.alert(
        'Riproduzione',
        e instanceof Error
          ? e.message
          : 'Impossibile aprire il brano. Riprova.'
      );
    }
  }
  const seek = (seconds: number) => {
    const target = Math.max(0, seconds);
    lastKnownPosition.current = target;
    void player.seekTo(target).catch(() =>
      Alert.alert(
        'Riproduzione',
        'Impossibile spostarsi in questo brano.'
      )
    );
  };
  const toggle = () => {
    if (status.playing) {
      player.pause();
      if (current) {
        void persistPlayerState(
          current,
          lastKnownPosition.current
        );
      }
    }
    else if (status.didJustFinish) { void player.seekTo(0).then(() => player.play()).catch(() => Alert.alert('Audio', 'Impossibile riavviare il brano.')); }
    else player.play();
  };
  useEffect(() => { player.loop = repeat === 'one'; }, [repeat, player]);
  function moveQueueItem(fromIndex: number, toIndex: number) {
    if (
      fromIndex === toIndex ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= queue.length ||
      toIndex >= queue.length
    ) {
      return;
    }

    const selectedId = current?.id;
    const nextQueue = [...queue];
    const [moved] = nextQueue.splice(fromIndex, 1);

    if (!moved) return;

    nextQueue.splice(toIndex, 0, moved);
    setQueue(nextQueue);

    if (selectedId) {
      const nextIndex = nextQueue.findIndex(song => song.id === selectedId);
      if (nextIndex >= 0 && nextIndex !== index) {
        setIndex(nextIndex);
      }
    }
  }

  function next() {
    if (shuffle && queue.length > 1) { start(queue, (index + 1 + Math.floor(Math.random() * (queue.length - 1))) % queue.length, false); return; }
    if (index + 1 < queue.length) start(queue, index + 1, false);
    else if (repeat === 'all' && queue.length) start(queue, 0, false);
  }
  useEffect(() => { if (status.didJustFinish && repeat !== 'one') next(); }, [status.didJustFinish]);

  useEffect(() => {
    setRemoteControlsEnabled(true);

    const nextSubscription = addRemoteNextListener(() => {
      next();
    });

    const previousSubscription = addRemotePreviousListener(() => {
      if (lastKnownPosition.current > 3) {
        seek(0);
        return;
      }

      if (index > 0) {
        start(queue, index - 1, false);
      }
    });

    return () => {
      nextSubscription?.remove();
      previousSubscription?.remove();
      setRemoteControlsEnabled(false);
    };
  }, [index, player, queue, repeat, shuffle]);
  useEffect(() => () => { if (sleepTimer.current) clearTimeout(sleepTimer.current); }, []);
  function sleep(minutes: number) { if (sleepTimer.current) clearTimeout(sleepTimer.current); setSleepMinutes(minutes); if (minutes) sleepTimer.current = setTimeout(() => { player.pause(); setSleepMinutes(0); }, minutes * 60000); }
  function browse(type: 'album' | 'artist') {
    if (!current) return;
    setExpanded(false);
    if (type === 'album' && current.albumId) openAlbum({ id: current.albumId, name: current.album ?? current.title, artist: current.artist, coverArt: current.coverArt });
    else { setAlbum(null); setQuery(type === 'artist' ? current.artist : current.album ?? current.title); setTab('Cerca'); }
  }

  async function more() {
    const version = generation.current;
    setBusy(true); setError('');
    try {
      const data = await request<{ albums: Album[]; hasMore: boolean }>('albums?offset=' + albums.length + '&sort=' + (tab === 'Novità' ? 'newest' : 'alphabeticalByName'));
      if (version === generation.current) { setAlbums(previous => [...previous, ...data.albums]); setHasMore(data.hasMore); }
    } catch (e) { if (version === generation.current) setError(message(e)); }
    finally { if (version === generation.current) setBusy(false); }
  }
  const songRows = (songs: Song[]) => songs.map((song, i) => (
    <View
      key={song.id + i}
      style={{ flexDirection: 'row', alignItems: 'center' }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={'Riproduci ' + song.title}
        onPress={() => start(songs, i, false)}
        style={[s.row, s.flex]}
      >
        <View style={s.songArtworkWrap}>
          <Artwork id={song.coverArt} size={50} />

          {current?.id === song.id && (
            <View style={s.nowPlayingArtworkBadge}>
              <NowPlayingWaves
                playing={!!status.playing}
                color="#fff"
                size={15}
              />
            </View>
          )}
        </View>

        <View style={s.flex}>
          <Text
            numberOfLines={1}
            style={[s.text, current?.id === song.id && s.accent]}
          >
            {song.title}
          </Text>

          <Text numberOfLines={1} style={s.sub}>
            {song.artist}
          </Text>
        </View>

        <Text style={s.sub}>
          {clock(song.duration)}
        </Text>
      </Pressable>

      <DownloadBadge song={song} />

      <Pressable
        accessibilityLabel={'Opzioni per ' + song.title}
        onPress={() => setActionSong(song)}
        style={s.button}
      >
        <Ionicons
          name="ellipsis-horizontal"
          size={24}
          color={c.secondary}
        />
      </Pressable>
    </View>
  ));
  const albumCaption = (item: Album) => <View style={{ flexDirection: 'row', alignItems: 'center' }}><Pressable style={{ flex: 1 }} onPress={() => openAlbum(item)}><Text numberOfLines={1} style={s.cardTitle}>{item.name}</Text><Text numberOfLines={1} style={s.sub}>{item.artist}</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={'Opzioni album ' + item.name} onPress={() => setActionAlbum(item)} style={{ width: 44, height: 48, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="ellipsis-horizontal" color={c.secondary} size={22} /></Pressable></View>;
  const featured = (items: Album[]) => <ScrollView horizontal showsHorizontalScrollIndicator={false} decelerationRate="fast" snapToInterval={Math.min(width - 72, 320) + 14} contentContainerStyle={{ gap: 14 }}>{items.slice(0, 6).map(item => <View key={item.id} style={{ width: Math.min(width - 72, 320), borderRadius: 16, overflow: 'hidden', backgroundColor: c.surface }}><Pressable onPress={() => openAlbum(item)} accessibilityLabel={'Apri ' + item.name}><Artwork id={item.coverArt} size={Math.min(width - 72, 320)} /></Pressable><View style={{ padding: 16 }}><Text style={{ color: c.accent, fontSize: 11, fontWeight: '700', letterSpacing: 1 }}>NELLA TUA LIBRERIA</Text>{albumCaption(item)}</View></View>)}</ScrollView>;
  const cards = (items: Album[], rail = false) => <View style={rail ? s.rail : s.grid}>{items.map(item => <View key={item.id} style={{ width: rail ? 155 : (width - 54) / 2 }}><Pressable onPress={() => openAlbum(item)} accessibilityRole="button" accessibilityLabel={'Apri album ' + item.name}><Artwork id={item.coverArt} size={rail ? 155 : (width - 54) / 2} /></Pressable>{albumCaption(item)}</View>)}</View>;

  const renderCatalogPage = (targetTab: 'Home' | 'Novità') => (
      <ScrollView
        style={s.flex}
        contentContainerStyle={s.page}
        keyboardShouldPersistTaps="handled"
        onScroll={mini.onScroll}
        scrollEventThrottle={32}
      >
        <View style={s.headingRow}>
          <Text style={[s.title, { flex: 1 }]}>{targetTab}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Apri impostazioni"
            onPress={() => setSettingsOpen(true)}
            style={s.profile}
          >
            <Ionicons
              name="person-circle-outline"
              size={38}
              color={c.accent}
            />
          </Pressable>
        </View>

        {targetTab === 'Home' && isOffline && (
          <View style={s.offlineNotice}>
            <View style={s.offlineNoticeIcon}>
              <Ionicons
                name="cloud-offline-outline"
                size={16}
                color={c.secondary}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.offlineNoticeTitle}>
                Sei offline
              </Text>
              <Text style={s.offlineNoticeMessage}>
                Stai ascoltando la musica salvata su questo iPhone.
              </Text>
            </View>
          </View>
        )}

        {!!error && (
          <View style={s.notice}>
            <View style={s.noticeHeader}>
              <View style={s.noticeIcon}>
                <Ionicons
                  name="wifi-outline"
                  size={17}
                  color={c.accent}
                />
              </View>

              <View style={{ flex: 1 }}>
                <Text style={s.noticeTitle}>
                  Connessione non disponibile
                </Text>
                <Text
                  style={s.noticeMessage}
                  numberOfLines={2}
                >
                  {error === 'Nessuna connessione al server.'
                    ? 'Impossibile raggiungere il server. Controlla la connessione e riprova.'
                    : error}
                </Text>
              </View>
            </View>

            <View style={s.recoveryActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Riprova connessione"
                onPress={() => setReload(n => n + 1)}
                style={[s.recoveryPill, s.recoveryPillPrimary]}
              >
                <Text style={s.recoveryPillPrimaryText}>
                  Riprova
                </Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Disconnetti account"
                onPress={onLogout}
                style={s.recoveryPill}
              >
                <Text style={s.recoveryPillText}>
                  Disconnetti
                </Text>
              </Pressable>
            </View>
          </View>
        )}

        {busy && (
          <ActivityIndicator
            color={c.accent}
            style={{ margin: 24 }}
          />
        )}

        <Animated.View style={{ opacity: catalogOpacity }}>
        {targetTab === 'Home' ? (
          <>
            {home && (
              <>
                <Text style={s.section}>In primo piano per te</Text>
                {featured(home.recentAlbums)}

                <Text style={s.section}>Aggiunti di recente</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                >
                  {cards(home.recentAlbums, true)}
                </ScrollView>

                <Text style={s.section}>Riscopri la tua musica</Text>
                {songRows(home.madeForYou)}

                {!home.recentAlbums.length &&
                  !home.madeForYou.length && (
                    <Text style={s.sub}>
                      La tua libreria è vuota.
                    </Text>
                  )}
              </>
            )}
          </>
        ) : (
          <>
            <Text style={s.kicker}>
              APPENA AGGIUNTI AL TUO SERVER
            </Text>
            {featured(albums)}

            <Text style={s.section}>Tutte le aggiunte</Text>
            {cards(albums)}

            {!busy && !error && !albums.length && (
              <Text style={s.sub}>
                Nessun album disponibile.
              </Text>
            )}

            {hasMore && (
              <Button
                label="Carica altri album"
                disabled={busy}
                onPress={() => void more()}
              />
            )}
          </>
        )}
        </Animated.View>
      </ScrollView>
  );

  return (
    <SafeAreaView
      ref={safeAreaRef}
      style={s.safe}
      onLayout={event => {
        const { width: layoutWidth, height: layoutHeight } = event.nativeEvent.layout;
        updateSafeAreaMetrics(layoutWidth, layoutHeight);
      }}
    >
    <StatusBar style={album ? 'light' : isDark ? 'light' : 'dark'} />
    {connectivityBanner && (
      <View pointerEvents="none" style={s.connectivityBannerWrap}>
        <Animated.View
          style={[
            s.connectivityBanner,
            {
              opacity: connectivityBannerOpacity,
              transform: [
                { translateY: connectivityBannerY },
                { scale: connectivityBannerScale },
              ],
            },
          ]}
        >
          <View
            style={[
              s.connectivityBannerIcon,
              connectivityBanner === 'online' && {
                backgroundColor: c.background,
              },
            ]}
          >
            <Ionicons
              name={
                connectivityBanner === 'offline'
                  ? 'cloud-offline-outline'
                  : 'checkmark-circle'
              }
              size={15}
              color={
                connectivityBanner === 'offline'
                  ? c.secondary
                  : c.accent
              }
            />
          </View>

          <Text style={s.connectivityBannerTitle}>
            {connectivityBanner === 'offline'
              ? 'Sei offline'
              : 'Di nuovo online'}
          </Text>
        </Animated.View>
      </View>
    )}
    {settingsOpen && (
      <SettingsScreen
        onClose={() => setSettingsOpen(false)}
        onLogout={() => {
          audioGeneration.current++;

          try {
            player.pause();
          } catch {}

          setQueue([]);
          setIndex(-1);
          setExpanded(false);
          setSettingsOpen(false);

          onLogout();
        }}
      />
    )}
    {actionAlbum && <AlbumActions key={actionAlbum.id} album={actionAlbum} onClose={() => setActionAlbum(null)} onOpen={() => openAlbum(actionAlbum)} onPlay={songs => start(songs, 0, false)} onQueue={songs => { if (!current) start(songs, 0, false); else setQueue(old => [...old, ...songs]); }} onDeleted={(ids, complete) => { deletedSongs(ids); if (complete && album?.id === actionAlbum.id) setAlbum(null); }} />}
    {actionSong && <SongActions key={actionSong.id} song={actionSong} onClose={() => setActionSong(null)} onPlay={() => start([actionSong], 0, false)} onQueue={() => { if (!current) start([actionSong], 0, false); else setQueue(old => [...old, actionSong]); }} onBrowse={type => browseSong(actionSong, type)} onDeleted={deleted} onFavorite={(id, starred) => { setQueue(old => old.map(song => song.id === id ? { ...song, starred } : song)); setReload(v => v + 1); }} />}
    {mountedTabs.current.has('Libreria') && (
      <View
        pointerEvents={tab === 'Libreria' ? 'auto' : 'none'}
        style={[s.flex, tab !== 'Libreria' && { display: 'none' }]}
      >
        <LibraryScreen
          revision={reload}
          onSettings={() => setSettingsOpen(true)}
          onPlay={start}
          onAlbum={openAlbum}
          onAlbumActions={setActionAlbum}
          onActions={setActionSong}
          onScroll={mini.onScroll}
          currentId={current?.id}
          isPlaying={!!status.playing}
        />
      </View>
    )}

    {mountedTabs.current.has('Cerca') && (
      <View
        pointerEvents={tab === 'Cerca' ? 'auto' : 'none'}
        style={[s.flex, tab !== 'Cerca' && { display: 'none' }]}
      >
      <SearchScreen
        key={query + ':' + (isOffline ? 'offline' : 'online')}
        isActive={tab === 'Cerca'}
        initialQuery={query}
        onSettings={() => setSettingsOpen(true)}
        onPlay={song => start([song], 0, false)}
        onAlbum={openAlbum}
        onAlbumActions={setActionAlbum}
        beforePreview={() => player.pause()}
        localPlaying={status.playing}
        onActions={setActionSong}
        onScroll={mini.onScroll}
      />
      </View>
    )}

    {(['Home', 'Novità'] as const).map(targetTab =>
      mountedTabs.current.has(targetTab) ? (
        <View
          key={targetTab}
          pointerEvents={tab === targetTab ? 'auto' : 'none'}
          style={[
            s.flex,
            tab !== targetTab && { display: 'none' },
          ]}
        >
          {renderCatalogPage(targetTab)}
        </View>
      ) : null
    )}

    {album && (() => {
      const albumCover = coverURL(album.coverArt);
      const artworkSize = Math.min(width * 0.62, 265);
      const totalSeconds = albumSongs.reduce(
        (sum, song) => sum + (song.duration || 0),
        0
      );
      const roundedMinutes = Math.max(
        1,
        Math.round(totalSeconds / 60)
      );
      const countLabel =
        albumSongs.length === 1
          ? '1 brano'
          : `${albumSongs.length} brani`;
      const durationLabel =
        roundedMinutes === 1
          ? '1 minuto'
          : `${roundedMinutes} minuti`;
      const allDownloaded =
        !!albumSongs.length &&
        albumSongs.every(song => !!offlineStore.tracks[song.id]);

      const metrics = safeAreaMetrics.current;
      const finalWidth = metrics.width || width;
      const finalHeight = metrics.height || height;
      const rootX = metrics.x || 0;
      const rootY = metrics.y || 0;

      const measuredScale = albumOrigin?.width
        ? albumOrigin.width / finalWidth
        : 0.90;

      const startScale = Math.max(0.40, Math.min(0.92, measuredScale));

      const sourceCenterX = albumOrigin
        ? albumOrigin.x - rootX + albumOrigin.width / 2
        : finalWidth / 2;

      const sourceCenterY = albumOrigin
        ? albumOrigin.y - rootY + albumOrigin.height / 2
        : finalHeight / 2 + 8;

      const startTranslateX = sourceCenterX - finalWidth / 2;
      const startTranslateY = sourceCenterY - finalHeight / 2;

      const translateX = albumOpenProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [startTranslateX, 0],
      });

      const translateY = albumOpenProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [startTranslateY, 0],
      });

      const scale = albumOpenProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [startScale, 1],
      });

      const backdropOpacity = albumOpenProgress.interpolate({
        inputRange: [0, 0.55, 1],
        outputRange: [0, 0.22, 1],
      });

      return (
        <>
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              s.albumTransitionBackdrop,
              { opacity: backdropOpacity },
            ]}
          />

          <Animated.View
            pointerEvents="box-none"
            style={[
              StyleSheet.absoluteFill,
              s.albumTransitionLayer,
              {
                opacity: albumCloseOpacity,
                transform: [{ translateX }, { translateY }],
              },
            ]}
          >
            <Animated.View
              style={[
                s.albumDetailOverlay,
                { transform: [{ scale }] },
              ]}
            >
          <View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor: albumCover
                  ? 'rgba(27,18,16,0.98)'
                  : c.background,
              },
            ]}
          />

          <LinearGradient
            pointerEvents="none"
            colors={[
              'rgba(20,12,11,0.20)',
              'rgba(21,13,12,0.52)',
              'rgba(18,10,10,0.90)',
              'rgba(13,9,9,0.98)',
            ]}
            locations={[0, 0.32, 0.72, 1]}
            style={StyleSheet.absoluteFill}
          />

          <SafeAreaView style={s.albumDetailSafeArea}>
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={s.albumDetailContent}
              onScroll={mini.onScroll}
              scrollEventThrottle={32}
            >
              <View style={s.albumTopBar}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Indietro"
                onPress={closeAlbum}
                style={s.albumGlassCircle}
              >
                <GlassView
                  pointerEvents="none"
                  glassEffectStyle="regular"
                  isInteractive={false}
                  style={StyleSheet.absoluteFill}
                />
                <SymbolView
                  name="chevron.left"
                  size={17}
                  weight="semibold"
                  tintColor="#fff"
                />
              </Pressable>

              <View style={s.albumTopActions}>
                <GlassView
                  pointerEvents="none"
                  glassEffectStyle="regular"
                  isInteractive={false}
                  style={StyleSheet.absoluteFill}
                />

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Condividi album"
                  onPress={() =>
                    void Share.share({
                      message:
                        album.name +
                        (album.artist ? ' — ' + album.artist : ''),
                    })
                  }
                  style={s.albumTopAction}
                >
                  <SymbolView
                    name="square.and.arrow.up"
                    size={18}
                    weight="medium"
                    tintColor="#fff"
                  />
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={'Opzioni album ' + album.name}
                  onPress={() => setActionAlbum(album)}
                  style={s.albumTopAction}
                >
                  <SymbolView
                    name="ellipsis"
                    size={19}
                    weight="semibold"
                    tintColor="#fff"
                  />
                </Pressable>
              </View>
            </View>

            <View style={s.albumDetailHero}>
              {albumCover ? (
                <Image
                  source={{ uri: albumCover }}
                  resizeMode="cover"
                  style={{
                    width: artworkSize,
                    height: artworkSize,
                    borderRadius: 7,
                  }}
                />
              ) : (
                <View
                  style={[
                    s.albumArtworkFallback,
                    {
                      width: artworkSize,
                      height: artworkSize,
                    },
                  ]}
                >
                  <SymbolView
                    name="music.note"
                    size={80}
                    weight="regular"
                    tintColor="rgba(255,255,255,0.55)"
                  />
                </View>
              )}

              <Text
                numberOfLines={3}
                style={s.albumDetailTitle}
              >
                {album.name}
              </Text>

              {!!album.artist && (
                <Text
                  numberOfLines={1}
                  style={s.albumDetailArtist}
                >
                  {album.artist}
                </Text>
              )}

              <Text style={s.albumDetailMeta}>
                {[
                  album.year ? String(album.year) : '',
                  'Lossless',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>

            <View style={s.albumDetailControls}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  shuffle
                    ? 'Disattiva riproduzione casuale'
                    : 'Attiva riproduzione casuale'
                }
                accessibilityState={{ selected: shuffle }}
                onPress={shuffleAlbum}
                style={[
                  s.albumRoundAction,
                  shuffle && s.albumRoundActionActive,
                ]}
              >
                <SymbolView
                  name="shuffle"
                  size={18}
                  weight="semibold"
                  tintColor={shuffle ? '#111' : '#fff'}
                />
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Riproduci album"
                onPress={() => {
                  if (albumSongs.length) {
                    start(albumSongs, 0, false);
                  }
                }}
                style={s.albumPlayPill}
              >
                <SymbolView
                  name="play.fill"
                  size={16}
                  weight="semibold"
                  tintColor="#111"
                />
                <Text style={s.albumPlayText}>
                  Riproduci
                </Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  allDownloaded
                    ? 'Album già scaricato'
                    : 'Scarica album su iPhone'
                }
                onPress={downloadCurrentAlbum}
                style={s.albumRoundAction}
              >
                <SymbolView
                  name={
                    allDownloaded
                      ? 'checkmark.circle'
                      : 'arrow.down'
                  }
                  size={18}
                  weight="semibold"
                  tintColor="#fff"
                />
              </Pressable>
            </View>

            <View style={s.albumTrackList}>
              {albumSongs.map((song, i) => (
                <View key={song.id + ':' + i}>
                  <View style={s.albumTrackRow}>
                    <View style={s.albumTrackIndexSlot}>
                      {current?.id === song.id ? (
                        <NowPlayingWaves
                          playing={!!status.playing}
                          color="#fff"
                          size={17}
                        />
                      ) : (
                        <Text style={s.albumTrackIndex}>
                          {i + 1}
                        </Text>
                      )}
                    </View>

                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={'Riproduci ' + song.title}
                      onPress={() => start(albumSongs, i, false)}
                      style={{ flex: 1, minWidth: 0 }}
                    >
                      <Text
                        numberOfLines={1}
                        style={[
                          s.albumTrackTitle,
                          current?.id === song.id && {
                            color: c.accent,
                          },
                        ]}
                      >
                        {song.title}
                      </Text>
                    </Pressable>

                    <DownloadBadge song={song} />

                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={'Opzioni per ' + song.title}
                      onPress={() => setActionSong(song)}
                      style={s.albumTrackMore}
                    >
                      <SymbolView
                        name="ellipsis"
                        size={17}
                        weight="semibold"
                        tintColor="rgba(255,255,255,0.72)"
                      />
                    </Pressable>
                  </View>

                  {i < albumSongs.length - 1 && (
                    <View style={s.albumTrackSeparator} />
                  )}
                </View>
              ))}
            </View>

            {!busy && !error && !albumSongs.length && (
              <Text style={s.albumEmptyText}>
                Nessun brano nell’album.
              </Text>
            )}

            {!!error && (
              <Text style={s.albumEmptyText}>
                {error}
              </Text>
            )}

              {!!albumSongs.length && (
                <View style={s.albumFooterMeta}>
                  {!!album.year && (
                    <Text style={s.albumFooterText}>
                      {album.year}
                    </Text>
                  )}
                  <Text style={s.albumFooterText}>
                    {countLabel}, {durationLabel}
                  </Text>
                </View>
              )}
            </ScrollView>
          </SafeAreaView>
            </Animated.View>
          </Animated.View>
        </>
      );
    })()}

    <View pointerEvents="box-none" style={s.dock}>
    {current && (
      <Animated.View
        pointerEvents={mini.hidden ? 'none' : 'auto'}
        accessibilityElementsHidden={mini.hidden}
        importantForAccessibility={mini.hidden ? 'no-hide-descendants' : 'auto'}
        style={[
          s.mini,
          {
            transform: [
              { translateX: mini.slide },
              { scaleX: miniBubbleScaleX },
              { scaleY: miniBubbleScaleY },
            ],
          },
        ]}
      >
        <GlassBackground />

        <Pressable
          style={s.miniMain}
          onPressIn={() => {
            hapticLight();
            setExpanded(true);
          }}
          onPress={() => setExpanded(true)}
          accessibilityRole="button"
          accessibilityLabel="Apri player"
        >
          <Artwork
            id={current.coverArt}
            size={38}
            fallbackUri={currentArtworkUri}
          />

          <View style={s.flex}>
            <Text style={s.miniTitle} numberOfLines={1}>
              {current.title}
            </Text>
            <Text style={s.miniArtist} numberOfLines={1}>
              {current.artist}
            </Text>
          </View>
        </Pressable>

        <ElasticPlayPauseButton
          style={s.miniButton}
          playing={!!status.playing}
          accessibilityLabel={status.playing ? 'Pausa' : 'Riproduci'}
          onPress={toggleFromMiniPlayer}
          variant="ionicons"
          color={c.text}
          size={22}
        />

        <Pressable
          style={s.miniButton}
          accessibilityLabel="Brano successivo"
          disabled={index + 1 >= queue.length && repeat !== 'all' && !shuffle}
          onPress={() => {
            hapticLight();
            next();
          }}
        >
          <Ionicons
            name="play-forward"
            size={21}
            color={
              index + 1 < queue.length || repeat === 'all' || shuffle
                ? c.text
                : c.muted
            }
          />
        </Pressable>
      </Animated.View>
    )}
    <LiquidTabBar
      value={tab}
      accent={c.accent}
      inactive={c.secondary}
      onChange={nextTab => {
        setAlbum(null);
        setAlbumOrigin(null);
        setTab(nextTab);
      }}
    />
    </View>

    {current && <PlayerSheet visible={expanded} onClose={() => setExpanded(false)} song={current} artworkUri={currentArtworkUri} connectivityBanner={connectivityBanner} connectivityBannerOpacity={connectivityBannerOpacity} connectivityBannerScale={connectivityBannerScale} connectivityBannerY={connectivityBannerY} player={player} queue={queue} index={index} onSelect={i => start(queue, i, false)} onMoveQueueItem={moveQueueItem} onNext={next} onPrevious={() => lastKnownPosition.current > 3 ? seek(0) : start(queue, Math.max(0, index - 1), false)} onToggle={toggle} lyrics={lyrics} lyricsMessage={lyricsMessage} lyricsSource={lyricsSource} repeat={repeat} onRepeat={() => setRepeat(v => v === 'off' ? 'all' : v === 'all' ? 'one' : 'off')} shuffle={shuffle} onShuffle={() => setShuffle(v => !v)} onBrowse={browse} onFavorite={starred => setQueue(old => old.map(song => song.id === current.id ? { ...song, starred } : song))} onSleep={sleep} sleepMinutes={sleepMinutes} onDeleted={deleted} />}
    </SafeAreaView>
  );
}


function AppleMusicTabIcon({
  tab,
  selected,
  accent,
  inactive,
}: {
  tab: Tab;
  selected: boolean;
  accent: string;
  inactive: string;
}) {
  const color = selected ? accent : inactive;

  if (tab === 'Libreria') {
    // Apple Music's Library glyph is not music.note.list:
    // it looks like two stacked media cards with a music note on the front.
    return (
      <View style={{ width: 24, height: 23, position: 'relative' }}>
        <View
          style={{
            position: 'absolute',
            left: 5,
            top: 1,
            width: 16,
            height: 14,
            borderRadius: 2.5,
            borderWidth: 1.8,
            borderColor: color,
          }}
        />
        <View
          style={{
            position: 'absolute',
            left: 2,
            top: 5,
            width: 17,
            height: 15,
            borderRadius: 2.7,
            backgroundColor: color,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <SymbolView
            name="music.note"
            size={10}
            weight="semibold"
            tintColor={selected ? '#ffffff' : '#ffffff'}
          />
        </View>
      </View>
    );
  }

  const item = tabs.find(t => t.name === tab)!;

  return (
    <SymbolView
      name={item.icon}
      size={item.size}
      weight={tab === 'Cerca' ? 'medium' : 'regular'}
      tintColor={color}
    />
  );
}

function LiquidTabBar({
  value,
  accent,
  inactive,
  onChange,
}: {
  value: Tab;
  accent: string;
  inactive: string;
  onChange: (tab: Tab) => void;
}) {
  const [barWidth, setBarWidth] = useState(0);
  const barWidthRef = useRef(0);
  const dragging = useRef(false);
  const hoveredIndex = useRef(tabs.findIndex(t => t.name === value));
  const selectedIndex = useRef(hoveredIndex.current);

  const lensX = useRef(new Animated.Value(0)).current;
  const lensScaleX = useRef(new Animated.Value(1)).current;
  const lensScaleY = useRef(new Animated.Value(1)).current;
  const itemScales = useRef(tabs.map(() => new Animated.Value(1))).current;

  const tabWidth = barWidth > 0 ? barWidth / tabs.length : 0;
  // La lente resta quasi larga quanto una sezione e ha la stessa curvatura
  // della barra esterna: 54 px di altezza -> raggio 27 px.
  const lensWidth = tabWidth > 0 ? Math.max(70, tabWidth - 8) : 76;
  const lensHeight = 54;

  const indexForX = (x: number) => {
    const w = barWidthRef.current / tabs.length;
    if (!w) return selectedIndex.current;
    return Math.max(0, Math.min(tabs.length - 1, Math.floor(x / w)));
  };

  const restLeftForIndex = (index: number) => {
    const w = barWidthRef.current / tabs.length;
    const lw = w > 0 ? Math.max(70, w - 8) : 76;
    return index * w + (w - lw) / 2;
  };

  const animateHoveredItem = (index: number, active: boolean) => {
    if (!active || hoveredIndex.current !== index) {
      if (active && hoveredIndex.current !== index) {
        hapticSelection();
      }

      hoveredIndex.current = index;
      Animated.parallel(
        itemScales.map((scale, i) =>
          Animated.spring(scale, {
            toValue: active && i === index ? 1.10 : 1,
            useNativeDriver: true,
            speed: 28,
            bounciness: 5,
          })
        )
      ).start();
    }
  };

  const moveLensToFinger = (x: number) => {
    const width = barWidthRef.current;
    if (!width) return;

    const w = width / tabs.length;
    const lw = Math.max(70, w - 8);
    const minLeft = 4;
    const maxLeft = width - lw - 4;
    const left = Math.max(minLeft, Math.min(maxLeft, x - lw / 2));

    // Durante il trascinamento segue realmente il dito, senza fare snap.
    lensX.setValue(left);
    animateHoveredItem(indexForX(x), true);
  };

  const setPressed = (pressed: boolean) => {
    Animated.parallel([
      Animated.spring(lensScaleX, {
        toValue: pressed ? 1.08 : 1,
        useNativeDriver: true,
        speed: 26,
        bounciness: 6,
      }),
      Animated.spring(lensScaleY, {
        toValue: pressed ? 1.08 : 1,
        useNativeDriver: true,
        speed: 26,
        bounciness: 6,
      }),
    ]).start();
  };

  const snapToIndex = (index: number) => {
    Animated.spring(lensX, {
      toValue: restLeftForIndex(index),
      useNativeDriver: true,
      speed: 30,
      bounciness: 6,
    }).start();
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,

      onPanResponderGrant: event => {
        dragging.current = true;
        const x = event.nativeEvent.locationX;
        const index = indexForX(x);

        if (index !== selectedIndex.current) {
          hapticSelection();
        }

        hoveredIndex.current = index;
        moveLensToFinger(x);
        setPressed(true);
      },

      onPanResponderMove: event => {
        moveLensToFinger(event.nativeEvent.locationX);
      },

      onPanResponderRelease: event => {
        const index = indexForX(event.nativeEvent.locationX);
        dragging.current = false;
        selectedIndex.current = index;
        hoveredIndex.current = index;
        setPressed(false);
        animateHoveredItem(index, false);
        snapToIndex(index);

        // Il cambio pagina avviene SOLO quando il dito viene rilasciato.
        onChange(tabs[index].name);
      },

      onPanResponderTerminate: () => {
        dragging.current = false;
        hoveredIndex.current = selectedIndex.current;
        setPressed(false);
        animateHoveredItem(selectedIndex.current, false);
        snapToIndex(selectedIndex.current);
      },
    })
  ).current;

  useEffect(() => {
    const index = tabs.findIndex(t => t.name === value);
    selectedIndex.current = index;
    hoveredIndex.current = index;
    if (barWidthRef.current && !dragging.current) {
      snapToIndex(index);
    }
  }, [value, barWidth]);

  return (
    <View
      style={liquidTabStyles.bar}
      onLayout={event => {
        const width = event.nativeEvent.layout.width;
        barWidthRef.current = width;
        setBarWidth(width);
        const index = tabs.findIndex(t => t.name === value);
        selectedIndex.current = index;
        hoveredIndex.current = index;
        const w = width / tabs.length;
        const lw = Math.max(70, w - 8);
        lensX.setValue(index * w + (w - lw) / 2);
      }}
      {...responder.panHandlers}
    >
      {/* Vetro della barra principale. Il borderRadius è applicato al GlassView
          stesso, non solo al contenitore, così i bordi risultano realmente tondi. */}
      <GlassView
        pointerEvents="none"
        style={liquidTabStyles.barGlass}
        glassEffectStyle="regular"
      />

      {barWidth > 0 && (
        <Animated.View
          pointerEvents="none"
          style={[
            liquidTabStyles.lens,
            {
              width: lensWidth,
              height: lensHeight,
              borderRadius: lensHeight / 2,
              transform: [
                { translateX: lensX },
                { scaleX: lensScaleX },
                { scaleY: lensScaleY },
              ],
            },
          ]}
        >
          <GlassView
            style={[
              StyleSheet.absoluteFill,
              liquidTabStyles.lensGlass,
              { borderRadius: lensHeight / 2 },
            ]}
            glassEffectStyle="clear"
            tintColor="rgba(255,255,255,0.10)"
          />
        </Animated.View>
      )}

      <View pointerEvents="none" style={liquidTabStyles.itemsRow}>
        {tabs.map((item, index) => {
          const selected = value === item.name;
          return (
            <View
              key={item.name}
              accessible
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={item.name}
              style={liquidTabStyles.item}
            >
              <Animated.View
                style={[
                  liquidTabStyles.itemContent,
                  { transform: [{ scale: itemScales[index] }] },
                ]}
              >
                <AppleMusicTabIcon
                  tab={item.name}
                  selected={selected}
                  accent={accent}
                  inactive={inactive}
                />
                <Text
                  numberOfLines={1}
                  style={[
                    liquidTabStyles.label,
                    { color: selected ? accent : inactive },
                    selected && liquidTabStyles.labelSelected,
                  ]}
                >
                  {item.name}
                </Text>
              </Animated.View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function Artwork({
  id,
  size,
  fallbackUri,
}: {
  id?: string;
  size: number;
  fallbackUri?: string;
}) {
  const { colors: c } = useTheme();
  const [failed, setFailed] = useState(false);
  const uri = coverURL(id) ?? fallbackUri;

  useEffect(() => setFailed(false), [id, uri]);

  return uri && !failed ? (
    <Image
      source={{ uri }}
      onError={() => setFailed(true)}
      style={{
        width: size,
        height: size,
        borderRadius: 12,
        backgroundColor: c.surface,
      }}
    />
  ) : (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: 12,
        backgroundColor: c.surface,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: c.secondary, fontSize: size / 3 }}>♪</Text>
    </View>
  );
}
function Button({ label, onPress, disabled = false, large = false, accessibilityLabel }: { label: string; onPress: () => void; disabled?: boolean; large?: boolean; accessibilityLabel?: string }) {
  const { colors: c } = useTheme(); const s = makeStyles(c);
  const icons: Record<string, keyof typeof Ionicons.glyphMap> = { '▶': 'play', 'Ⅱ': 'pause', '|◀': 'play-back', '▶|': 'play-forward', '⌄': 'chevron-down' };
  const icon = icons[label];
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} disabled={disabled} onPress={onPress} style={[s.button, disabled && { opacity: 0.3 }]}>{icon ? <Ionicons name={icon} color={c.text} size={large ? 52 : 28} /> : <Text style={[s.buttonText, large && { fontSize: 46 }]}>{label}</Text>}</Pressable>;
}
const makeStyles = (c: Palette) => StyleSheet.create({
  dock: { position: 'absolute', bottom: 24, left: 10, right: 10, zIndex: 60 },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10, marginBottom: 4 }, profile: { width: 46, height: 46, borderRadius: 23, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' },
  libraryRow: { flexDirection: 'row', alignItems: 'center', gap: 18, paddingVertical: 19, borderBottomWidth: 0.5, borderColor: c.border },
  safe: { flex: 1, backgroundColor: c.background }, flex: { flex: 1 }, page: { padding: 20, paddingBottom: 190 },
  kicker: { color: c.secondary, fontSize: 11, letterSpacing: 2, fontWeight: '700', marginVertical: 10 },
  title: { color: c.text, fontSize: 36, fontWeight: '800', letterSpacing: -1 },
  section: { color: c.text, fontSize: 22, fontWeight: '700', marginTop: 28, marginBottom: 16 },
  text: { color: c.text, fontSize: 16, fontWeight: '600' }, sub: { color: c.secondary, fontSize: 13, marginTop: 4 }, accent: { color: c.accent },
  hint: { color: c.secondary, fontSize: 15, lineHeight: 23, marginVertical: 22 },
  rail: { flexDirection: 'row', gap: 14 }, grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 }, cardTitle: { color: c.text, fontWeight: '600', marginTop: 9 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9 },
  songArtworkWrap: {
    width: 50,
    height: 50,
    position: 'relative',
    marginRight: 12,
  },
  nowPlayingArtworkBadge: {
    position: 'absolute',
    right: 3,
    bottom: 3,
    width: 23,
    height: 23,
    borderRadius: 11.5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.64)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  albumHero: { alignItems: 'center', gap: 12, marginVertical: 20 },
  albumTransitionBackdrop: {
    zIndex: 29,
    elevation: 29,
    backgroundColor: '#120b0a',
  },
  albumTransitionLayer: {
    zIndex: 30,
    elevation: 30,
  },
  albumDetailOverlay: {
    flex: 1,
    overflow: 'hidden',
    borderRadius: 28,
    backgroundColor: '#120b0a',
  },
  albumDetailSafeArea: {
    flex: 1,
  },
  albumDetailContent: {
    paddingHorizontal: 18,
    paddingTop: 6,
    paddingBottom: 205,
  },
  albumTopBar: {
    minHeight: 54,
    marginTop: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  albumGlassCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  albumTopActions: {
    width: 86,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  albumTopAction: {
    width: 43,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  albumDetailHero: {
    alignItems: 'center',
    paddingTop: 18,
  },
  albumArtworkFallback: {
    borderRadius: 7,
    backgroundColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  albumDetailTitle: {
    color: '#fff',
    fontSize: 17.5,
    lineHeight: 21,
    fontWeight: '700',
    letterSpacing: -0.35,
    textAlign: 'center',
    marginTop: 18,
    paddingHorizontal: 6,
  },
  albumDetailArtist: {
    color: '#fff',
    fontSize: 14.5,
    lineHeight: 18,
    fontWeight: '500',
    letterSpacing: -0.15,
    marginTop: 5,
  },
  albumDetailMeta: {
    color: 'rgba(255,255,255,0.52)',
    fontSize: 10.5,
    lineHeight: 13,
    marginTop: 4,
  },
  albumDetailControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 13,
    marginTop: 17,
    marginBottom: 17,
  },
  albumRoundAction: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.09)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  albumRoundActionActive: {
    backgroundColor: 'rgba(255,255,255,0.96)',
  },
  albumPlayPill: {
    minWidth: 126,
    height: 40,
    borderRadius: 20,
    paddingHorizontal: 22,
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  albumPlayText: {
    color: '#111',
    fontSize: 14.5,
    lineHeight: 18,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  albumTrackList: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  albumTrackRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
  },
  albumTrackIndexSlot: {
    width: 29,
    alignItems: 'center',
    justifyContent: 'center',
  },
  albumTrackIndex: {
    width: 29,
    color: 'rgba(255,255,255,0.45)',
    fontSize: 13,
    textAlign: 'center',
  },
  albumTrackTitle: {
    color: '#fff',
    fontSize: 15.5,
    lineHeight: 19,
    fontWeight: '500',
    letterSpacing: -0.20,
  },
  albumTrackMore: {
    width: 34,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  albumTrackSeparator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 29,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  albumEmptyText: {
    color: 'rgba(255,255,255,0.60)',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    paddingVertical: 22,
  },
  albumFooterMeta: {
    paddingTop: 18,
    paddingBottom: 8,
  },
  albumFooterText: {
    color: 'rgba(255,255,255,0.44)',
    fontSize: 10.5,
    lineHeight: 14,
  },
  search: { color: c.text, backgroundColor: c.surface, borderRadius: 26, padding: 16, marginTop: 18, fontSize: 16 },
  connectivityBannerWrap: {
    position: 'absolute',
    top: 66,
    left: 14,
    right: 14,
    zIndex: 140,
    alignItems: 'center',
  },
  connectivityBanner: {
    minHeight: 40,
    maxWidth: 220,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: c.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  connectivityBannerIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.background,
  },
  connectivityBannerTitle: {
    color: c.text,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: -0.05,
  },
  offlineNotice: {
    paddingVertical: 11,
    paddingHorizontal: 13,
    backgroundColor: c.surface,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    marginTop: 12,
    marginBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  offlineNoticeIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.background,
  },
  offlineNoticeTitle: {
    color: c.text,
    fontSize: 13,
    fontWeight: '600',
  },
  offlineNoticeMessage: {
    color: c.secondary,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 2,
  },
  notice: {
    padding: 14,
    backgroundColor: c.surface,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    marginVertical: 14,
  },
  noticeHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 11,
  },
  noticeIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.background,
  },
  noticeTitle: {
    color: c.text,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.1,
  },
  noticeMessage: {
    color: c.secondary,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 3,
  },
  recoveryActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  recoveryPill: {
    minHeight: 34,
    paddingHorizontal: 13,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.background,
  },
  recoveryPillPrimary: {
    backgroundColor: c.accent,
  },
  recoveryPillText: {
    color: c.text,
    fontSize: 13,
    fontWeight: '600',
  },
  recoveryPillPrimaryText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  mini: {
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 10,
    marginBottom: 6,
    paddingLeft: 7,
    paddingRight: 5,
    borderRadius: 27,
    backgroundColor: 'transparent',
    overflow: 'hidden',
    borderWidth: 0.5,
    borderColor: c.border,
  },
  miniMain: {
    flex: 1,
    minWidth: 0,
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingRight: 4,
  },
  miniTitle: {
    color: c.text,
    fontSize: 14,
    lineHeight: 17,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  miniArtist: {
    color: c.secondary,
    fontSize: 11.5,
    lineHeight: 14,
    marginTop: 1,
  },
  miniButton: {
    width: 39,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  button: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', padding: 10 }, buttonText: { color: c.accent, fontSize: 19, fontWeight: '700' },
  player: { flex: 1, backgroundColor: c.background }, playerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 15 },
  playerBody: { alignItems: 'center', paddingHorizontal: 32, paddingBottom: 24, paddingTop: 18, gap: 18 },
  trackInfo: { width: '100%', marginTop: 8 }, trackTitle: { color: c.text, fontSize: 26, fontWeight: '700' }, trackArtist: { color: c.secondary, fontSize: 21, marginTop: 6 },
  seekArea: { height: 28, justifyContent: 'center' }, progress: { height: 5, borderRadius: 5, backgroundColor: c.border, overflow: 'hidden' }, fill: { height: 5, backgroundColor: c.text },
  times: { flexDirection: 'row', justifyContent: 'space-between' }, controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', width: '100%' },
  lyric: { color: c.muted, fontSize: 28, fontWeight: '700', lineHeight: 37, marginBottom: 22 }, lyricActive: { color: c.text },
});


const liquidTabStyles = StyleSheet.create({
  bar: {
    height: 64,
    marginTop: 8,
    marginHorizontal: 10,
    borderRadius: 32,
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  barGlass: {
    ...StyleSheet.absoluteFill,
    borderRadius: 32,
  },
  lens: {
    position: 'absolute',
    left: 0,
    top: 5,
    overflow: 'hidden',
    zIndex: 1,
  },
  lensGlass: {
    overflow: 'hidden',
  },
  itemsRow: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
    zIndex: 2,
  },
  item: {
    flex: 1,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemContent: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 58,
  },
  label: {
    fontSize: 10,
    lineHeight: 11,
    fontWeight: '500',
    letterSpacing: -0.15,
    marginTop: 2,
  },
  labelSelected: {
    fontWeight: '600',
  },
});

import Pressable from './src/SpringPressable';
