import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Image, Modal, SafeAreaView, ScrollView, Share, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, {
  runOnJS,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { GlassView } from 'expo-glass-effect';
import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import type { AudioPlayer } from 'expo-audio';
import { coverURL, streamURL, request, type Song, type Lyrics } from './api';
import { useVisiblePlaybackStatus } from './usePlaybackSignals';
import { useTheme } from './theme';
import { LocalDownloadAction, DownloadBadge } from './OfflineDownloads';
import ElasticPlayPauseButton from './ElasticPlayPauseButton';
import { AirPlayButton, SystemVolumeSlider, nativeAirPlayAvailable, nativeSystemVolumeAvailable } from '../modules/metronomy-audio-controls';

type Props = {
  visible: boolean;
  onClose: () => void;
  song: Song;
  artworkUri?: string;
  connectivityBanner?: 'offline' | 'online' | null;
  connectivityBannerOpacity?: Animated.Value;
  connectivityBannerScale?: Animated.Value;
  connectivityBannerY?: Animated.Value;
  player: AudioPlayer;
  queue: Song[];
  index: number;
  onSelect: (index: number) => void;
  onMoveQueueItem?: (fromIndex: number, toIndex: number) => void;
  onNext: () => void;
  onPrevious: () => void;
  onToggle: () => void;
  lyrics: Lyrics | null;
  lyricsMessage: string;
  lyricsSource: string;
  repeat: 'off' | 'all' | 'one';
  onRepeat: () => void;
  shuffle: boolean;
  onShuffle: () => void;
  onBrowse: (type: 'album' | 'artist') => void;
  onFavorite: (starred: boolean) => void;
  onSleep: (minutes: number) => void;
  sleepMinutes: number;
  onDeleted: (id: string) => void;

  // Optional hooks: the current App.tsx does not need to change.
  onRemoveLocal?: () => void | Promise<void>;
  onDownload?: () => void;
  onCreateStation?: () => void;
  onHighlight?: () => void;
  onCredits?: () => void;
  onLessLikeThis?: () => void;
  onRemoveFromLibrary?: () => void;
};
const clock = (seconds: number) => { const n = Math.max(0, Math.floor(seconds || 0)); return Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0'); };

const QUEUE_ROW_HEIGHT = 68;

function QueueDropPlaceholder({
  hoverIndex,
  dragging,
}: {
  hoverIndex: SharedValue<number>;
  dragging: SharedValue<number>;
}) {
  const style = useAnimatedStyle(() => ({
    opacity: withTiming(dragging.value > 0.5 ? 1 : 0, {
      duration: dragging.value > 0.5 ? 90 : 120,
    }),
    transform: [
      {
        translateY: withTiming(
          Math.max(0, hoverIndex.value) * QUEUE_ROW_HEIGHT,
          { duration: 125 }
        ),
      },
      {
        scale: withTiming(dragging.value > 0.5 ? 1 : 0.985, {
          duration: 110,
        }),
      },
    ],
  }));

  return (
    <Reanimated.View
      pointerEvents="none"
      style={[playerStyles.queueDropPlaceholder, style]}
    />
  );
}

function QueueDragRow({
  song,
  realIndex,
  localIndex,
  localCount,
  minIndex,
  onSelect,
  onMove,
  playerSecondary,
  activeIndex,
  hoverIndex,
  dragY,
  dragging,
}: {
  song: Song;
  realIndex: number;
  localIndex: number;
  localCount: number;
  minIndex: number;
  onSelect: (index: number) => void;
  onMove?: (fromIndex: number, toIndex: number) => void;
  playerSecondary: string;
  activeIndex: SharedValue<number>;
  hoverIndex: SharedValue<number>;
  dragY: SharedValue<number>;
  dragging: SharedValue<number>;
}) {
  const artwork = coverURL(song.coverArt);
  const THRESHOLD = 0.54;

  const resetDrag = () => {
    dragY.value = 0;
    dragging.value = 0;
    activeIndex.value = -1;
    hoverIndex.value = -1;
  };

  const commitMove = (targetLocalIndex: number) => {
    const targetRealIndex = minIndex + targetLocalIndex;

    if (onMove && targetRealIndex !== realIndex) {
      onMove(realIndex, targetRealIndex);
    }

    requestAnimationFrame(resetDrag);
  };

  const dragGesture = Gesture.Pan()
    .enabled(!!onMove && localCount > 1)
    .activeOffsetY([-3, 3])
    .onBegin(() => {
      activeIndex.value = localIndex;
      hoverIndex.value = localIndex;
      dragY.value = 0;
      dragging.value = withTiming(1, { duration: 85 });
    })
    .onUpdate(event => {
      const minY = -localIndex * QUEUE_ROW_HEIGHT;
      const maxY =
        (localCount - 1 - localIndex) * QUEUE_ROW_HEIGHT;

      const clamped = Math.max(
        minY,
        Math.min(maxY, event.translationY)
      );

      dragY.value = clamped;

      let delta = 0;

      if (clamped > 0) {
        delta = Math.floor(
          (clamped +
            QUEUE_ROW_HEIGHT * (1 - THRESHOLD)) /
            QUEUE_ROW_HEIGHT
        );
      } else if (clamped < 0) {
        delta = Math.ceil(
          (clamped -
            QUEUE_ROW_HEIGHT * (1 - THRESHOLD)) /
            QUEUE_ROW_HEIGHT
        );
      }

      const target = Math.max(
        0,
        Math.min(localCount - 1, localIndex + delta)
      );

      if (hoverIndex.value !== target) {
        hoverIndex.value = target;
      }
    })
    .onEnd(() => {
      const target = Math.max(
        0,
        Math.min(localCount - 1, hoverIndex.value)
      );

      const snapY =
        (target - localIndex) * QUEUE_ROW_HEIGHT;

      dragY.value = withTiming(
        snapY,
        { duration: 105 },
        finished => {
          if (finished) {
            runOnJS(commitMove)(target);
          }
        }
      );
    })
    .onFinalize((_event, success) => {
      if (!success) {
        dragY.value = withTiming(0, { duration: 120 });
        dragging.value = withTiming(0, { duration: 100 });
        activeIndex.value = -1;
        hoverIndex.value = -1;
      }
    });

  const animatedStyle = useAnimatedStyle(() => {
    const active = activeIndex.value;
    const target = hoverIndex.value;
    const isActive = active === localIndex;

    let siblingShift = 0;

    if (!isActive && active >= 0 && target >= 0) {
      if (
        active < target &&
        localIndex > active &&
        localIndex <= target
      ) {
        siblingShift = -QUEUE_ROW_HEIGHT;
      } else if (
        active > target &&
        localIndex >= target &&
        localIndex < active
      ) {
        siblingShift = QUEUE_ROW_HEIGHT;
      }
    }

    const translateY = isActive
      ? dragY.value
      : withTiming(siblingShift, {
          duration: 135,
        });

    return {
      zIndex: isActive ? 30 : 1,
      opacity: isActive ? 0.97 : 1,
      transform: [
        { translateY },
        {
          scale: isActive
            ? withTiming(
                dragging.value > 0.5 ? 1.018 : 1,
                { duration: 105 }
              )
            : 1,
        },
      ],
    };
  });

  return (
    <Reanimated.View
      style={[playerStyles.queueRow, animatedStyle]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={'Riproduci ' + song.title}
        onPress={() => onSelect(realIndex)}
        style={playerStyles.queueRowMain}
      >
        {artwork ? (
          <Image
            source={{ uri: artwork }}
            style={playerStyles.queueArtwork}
          />
        ) : (
          <View style={playerStyles.queueArtworkFallback}>
            <SymbolView
              name="music.note"
              size={15}
              weight="medium"
              tintColor={playerSecondary}
            />
          </View>
        )}

        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            numberOfLines={1}
            style={playerStyles.queueSongTitle}
          >
            {song.title}
          </Text>

          <Text
            numberOfLines={1}
            style={playerStyles.queueSongArtist}
          >
            {song.artist}
          </Text>
        </View>

        <View pointerEvents="none">
          <DownloadBadge song={song} />
        </View>
      </Pressable>

      <GestureDetector gesture={dragGesture}>
        <Reanimated.View
          accessibilityRole="adjustable"
          accessibilityLabel={'Riordina ' + song.title}
          style={playerStyles.queueDragHandle}
        >
          <SymbolView
            name={'line.3.horizontal' as SFSymbol}
            size={20}
            weight="regular"
            tintColor="rgba(255,255,255,0.36)"
          />
        </Reanimated.View>
      </GestureDetector>
    </Reanimated.View>
  );
}

export default function PlayerSheet(p: Props) {
  const status = useVisiblePlaybackStatus(p.player, p.visible);
  const { colors: c, isDark } = useTheme();
  const { width, height } = useWindowDimensions();
  const [mode, setMode] = useState<'cover' | 'lyrics' | 'queue'>('cover');
  const [queueMounted, setQueueMounted] = useState(false);
  const queueUnmountTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [menu, setMenu] = useState(false);
  const menuProgress = useRef(new Animated.Value(0)).current;
  const queueProgress = useRef(new Animated.Value(0)).current;
  const openProgress = useSharedValue(0);
  const sheetY = useSharedValue(0);

  const queueDragIndex = useSharedValue(-1);
  const queueHoverIndex = useSharedValue(-1);
  const queueDragY = useSharedValue(0);
  const queueDragging = useSharedValue(0);

  const closingPlayer = useRef(false);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [starred, setStarred] = useState(!!p.song.starred);
  const [volume, setVolume] = useState(p.player.volume);
  const [autoScroll, setAutoScroll] = useState(true);
  const [autoplay, setAutoplay] = useState(true);
  const [automix, setAutomix] = useState(false);
  const [playlists, setPlaylists] = useState<{ id: string; name: string }[] | null>(null);
  const [playlistBusy, setPlaylistBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const positions = useRef<Record<number, number>>({});
  const activeSong = useRef(p.song.id); activeSong.current = p.song.id;
  const localRemovalPlayback = useRef<{
    songId: string;
    wasPlaying: boolean;
    position: number;
  } | null>(null);
  const mounted = useRef(true);
  const uri = coverURL(p.song.coverArt) ?? p.artworkUri;
  // Apple Music-style player uses light foreground controls over a darkened
  // artwork-derived background. Keeping these independent from the app theme
  // avoids black controls on bright/colourful covers.
  const playerText = '#ffffff';
  const playerSecondary = 'rgba(255,255,255,0.72)';
  const playerMuted = 'rgba(255,255,255,0.30)';
  const playerTrack = 'rgba(255,255,255,0.24)';
  const menuText = '#ffffff';
  const menuSecondary = 'rgba(255,255,255,0.70)';
  const menuSeparator = 'rgba(255,255,255,0.16)';
  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;

      if (queueUnmountTimer.current) {
        clearTimeout(queueUnmountTimer.current);
        queueUnmountTimer.current = null;
      }
    };
  }, []);
  useEffect(() => { setStarred(!!p.song.starred); }, [p.song.id, p.song.starred]);
  useEffect(() => { positions.current = {}; setMenu(false); setPlaylists(null); menuProgress.setValue(0); }, [p.song.id]);
  useEffect(() => {
    if (p.visible) {
      closingPlayer.current = false;
      sheetY.value = 0;

      // First modal frame is already visible; then a short UI-thread spring.
      openProgress.value = 0.08;
      openProgress.value = withSpring(1, {
        damping: 29,
        stiffness: 390,
        mass: 0.60,
      });
    } else {
      setMenu(false);
      menuProgress.setValue(0);
      sheetY.value = 0;
      openProgress.value = 0;
      closingPlayer.current = false;
      setMode('cover');
      setQueueMounted(false);
      queueProgress.setValue(0);
    }
  }, [p.visible, height, menuProgress, openProgress, queueProgress, sheetY]);

  useEffect(() => {
    if (queueUnmountTimer.current) {
      clearTimeout(queueUnmountTimer.current);
      queueUnmountTimer.current = null;
    }

    if (mode === 'queue') {
      setQueueMounted(true);
    }

    Animated.spring(queueProgress, {
      toValue: mode === 'queue' ? 1 : 0,
      useNativeDriver: true,
      damping: 22,
      stiffness: 220,
      mass: 0.82,
      restDisplacementThreshold: 0.01,
      restSpeedThreshold: 0.01,
    }).start();

    if (mode !== 'queue') {
      queueUnmountTimer.current = setTimeout(() => {
        queueUnmountTimer.current = null;
        setQueueMounted(false);
      }, 280);
    }

    return () => {
      if (queueUnmountTimer.current) {
        clearTimeout(queueUnmountTimer.current);
        queueUnmountTimer.current = null;
      }
    };
  }, [mode, queueProgress]);

  useEffect(() => {
    if (mode === 'queue') return;

    queueDragY.value = 0;
    queueDragging.value = 0;
    queueDragIndex.value = -1;
    queueHoverIndex.value = -1;
  }, [
    mode,
    queueDragIndex,
    queueDragY,
    queueDragging,
    queueHoverIndex,
  ]);

  useEffect(() => {
    if (!menu) return;
    menuProgress.setValue(0);
    Animated.spring(menuProgress, {
      toValue: 1,
      useNativeDriver: true,
      damping: 19,
      stiffness: 240,
      mass: 0.75,
    }).start();
  }, [menu, menuProgress]);

  let active = -1;
  if (p.lyrics?.synced) p.lyrics.line.forEach((line, index) => { if (line.start !== undefined && line.start <= status.currentTime * 1000 + (p.lyrics?.offset ?? 0)) active = index; });
  useEffect(() => { if (autoScroll && mode === 'lyrics' && active >= 0) scroll.current?.scrollTo({ y: Math.max(0, (positions.current[active] ?? 0) - 100), animated: true }); }, [active, mode, autoScroll]);
  // Navidrome's catalog duration describes the actual track. For remote streams,
  // the native player can temporarily report a different container/stream duration.
  const catalogDuration = Number.isFinite(p.song.duration) && p.song.duration > 0
    ? p.song.duration
    : 0;
  const playerDuration = Number.isFinite(status.duration) && status.duration > 0
    ? status.duration
    : 0;
  const duration = catalogDuration || playerDuration;
  const currentTime = Math.max(0, status.currentTime || 0);
  const remainingTime = Math.max(0, duration - currentTime);
  const seek = (value: number) => { void p.player.seekTo(Math.min(duration, Math.max(0, value))).catch(() => Alert.alert('Riproduzione', 'Impossibile spostarsi nel brano.')); };
  const openMenu = () => {
    setPlaylists(null);
    setMenu(true);
  };
  const closeMenu = (after?: () => void) => {
    Animated.timing(menuProgress, {
      toValue: 0,
      duration: 130,
      useNativeDriver: true,
    }).start(() => {
      setMenu(false);
      setPlaylists(null);
      after?.();
    });
  };

  const dismissPlayer = (velocity = 0) => {
    if (closingPlayer.current) return;
    closingPlayer.current = true;
    setMenu(false);

    const duration = velocity > 900 ? 180 : 245;
    sheetY.value = withTiming(height * 0.36, { duration });
    openProgress.value = withTiming(
      0,
      { duration },
      finished => {
        if (finished) runOnJS(p.onClose)();
      }
    );
  };

  const restorePlayer = () => {
    sheetY.value = withSpring(0, {
      damping: 25,
      stiffness: 265,
      mass: 0.82,
    });
  };

  const playerPan = Gesture.Pan()
    .enabled(!menu)
    .activeOffsetY(4)
    .failOffsetX([-28, 28])
    .onUpdate(event => {
      const dy = event.translationY;
      sheetY.value = dy >= 0 ? dy : dy * 0.08;
    })
    .onEnd(event => {
      const shouldClose =
        event.translationY > Math.min(125, height * 0.15) ||
        event.velocityY > 820;

      if (shouldClose) {
        const duration = event.velocityY > 1200 ? 165 : 225;
        sheetY.value = withTiming(height * 0.36, { duration });
        openProgress.value = withTiming(
          0,
          { duration },
          finished => {
            if (finished) runOnJS(p.onClose)();
          }
        );
      } else {
        sheetY.value = withSpring(0, {
          damping: 25,
          stiffness: 265,
          mass: 0.82,
        });
      }
    });

  const playerTap = Gesture.Tap()
    .enabled(!menu)
    .maxDistance(8)
    .onEnd((_, success) => {
      if (success) runOnJS(dismissPlayer)();
    });

  const playerGesture = Gesture.Race(playerPan, playerTap);

  const playerAnimatedStyle = useAnimatedStyle(() => {
    const open = Math.min(1, Math.max(0, openProgress.value));
    const drag = Math.min(
      1,
      Math.max(0, sheetY.value / Math.max(1, height * 0.48))
    );

    // The reference player grows out of the mini-player instead of simply
    // sliding up. At progress 0 this is a small rounded card near the bottom.
    const openingScale = 0.22 + 0.78 * open;
    const dragScale = 1 - drag * 0.055;
    const openingY = (1 - open) * height * 0.36;

    return {
      opacity: 0.62 + 0.38 * open,
      borderRadius: 34 * (1 - open) + 30 * drag,
      transform: [
        { translateY: openingY + sheetY.value },
        { scale: openingScale * dragScale },
      ],
    };
  });

  const backdropAnimatedStyle = useAnimatedStyle(() => {
    const open = Math.min(1, Math.max(0, openProgress.value));
    const drag = Math.min(
      1,
      Math.max(0, sheetY.value / Math.max(1, height * 0.48))
    );
    return {
      opacity: 0.12 * open * (1 - drag),
    };
  });

  async function beforeRemoveLocal() {
    const songId = p.song.id;

    localRemovalPlayback.current = {
      songId,
      wasPlaying: !!status.playing,
      position: Math.max(0, status.currentTime || 0),
    };

    try {
      /*
       * Su iOS replace(null) può fallire con:
       * "function call exception calling the replace function has failed".
       *
       * Qui ci limitiamo quindi a mettere in pausa il player prima della
       * rimozione del file locale. La nuova sorgente server verrà caricata
       * soltanto dopo che OfflineStore avrà completato la cancellazione.
       */
      p.player.pause();

      await new Promise<void>(resolve => {
        setTimeout(resolve, 150);
      });

      await p.onRemoveLocal?.();
    } catch (e) {
      localRemovalPlayback.current = null;
      throw e;
    }
  }

  async function afterRemoveLocal() {
    const previous = localRemovalPlayback.current;
    localRemovalPlayback.current = null;

    if (!previous) return;

    // Se nel frattempo è cambiato brano, non tocchiamo il nuovo playback.
    if (activeSong.current !== previous.songId) return;

    try {
      /*
       * A questo punto OfflineStore ha già rimosso il file locale.
       * streamURL() quindi tornerà alla normale sorgente remota/server.
       */
      const remoteSource = streamURL(previous.songId);

      /*
       * Su iOS passiamo sempre una AudioSource esplicita.
       * Alcune versioni/runtime di expo-audio falliscono nel bridge nativo
       * quando replace() riceve direttamente una stringa, anche se il tipo
       * TypeScript la ammette.
       */
      p.player.replace({ uri: remoteSource });

      /*
       * replace() carica la nuova sorgente in modo asincrono.
       * Attendiamo un attimo prima di tentare il seek.
       */
      await new Promise<void>(resolve => {
        setTimeout(resolve, 250);
      });

      if (previous.position > 0) {
        try {
          await p.player.seekTo(previous.position);
        } catch {
          // Se non è ancora seekable, lasciamo il brano dall'inizio.
        }
      }

      if (previous.wasPlaying) {
        p.player.play();
      }
    } catch (e) {
      Alert.alert(
        'Riproduzione',
        e instanceof Error
          ? e.message
          : 'Impossibile ripristinare la riproduzione.'
      );
    }
  }

  async function favorite() {
    const songId = p.song.id; setFavoriteBusy(true);
    try { const result = await request<{ starred: boolean }>('songs/' + encodeURIComponent(songId) + '/favorite', 15000, { enabled: !starred }); if (mounted.current && activeSong.current === songId) { setStarred(result.starred); p.onFavorite(result.starred); } }
    catch (e) { Alert.alert('Preferiti', e instanceof Error ? e.message : 'Operazione non riuscita'); }
    finally { if (mounted.current) setFavoriteBusy(false); }
  }
  async function info() {
    closeMenu();
    try { const data = await request<{ info: Record<string, unknown> }>('songs/' + encodeURIComponent(p.song.id)); const labels: Record<string, string> = { genre: 'Genere', year: 'Anno', bitRate: 'Bitrate (kbps)', samplingRate: 'Campionamento (Hz)', bitDepth: 'Profondità (bit)', suffix: 'Formato', isrc: 'ISRC' }; const lines = Object.entries(labels).filter(([key]) => data.info[key] != null).map(([key, label]) => label + ': ' + data.info[key]); Alert.alert('Informazioni sul brano', `${p.song.title}\n${p.song.artist}\n${p.song.album ?? ''}\n\n${lines.join('\n') || 'Altri metadati non disponibili.'}`); }
    catch (e) { Alert.alert('Informazioni', e instanceof Error ? e.message : 'Non disponibili'); }
  }
  const share = (message: string) => { closeMenu(); void Share.share({ message }).catch(() => Alert.alert('Condivisione', 'Condivisione non riuscita.')); };
  async function choosePlaylist() {
    setPlaylistBusy(true);
    try { const data = await request<{ playlists: { id: string; name: string }[] }>('playlists'); if (mounted.current) setPlaylists(data.playlists); }
    catch (e) { Alert.alert('Playlist', e instanceof Error ? e.message : 'Non disponibili'); }
    finally { if (mounted.current) setPlaylistBusy(false); }
  }
  async function addPlaylist(id?: string, name?: string) {
    const songId = p.song.id; setPlaylistBusy(true);
    try { if (id) await request('playlists/' + encodeURIComponent(id) + '/songs/' + encodeURIComponent(songId), 15000, {}); else await request('playlists', 15000, { name, song_id: songId }); Alert.alert('Playlist', 'Brano aggiunto.'); if (mounted.current) { closeMenu(); } }
    catch (e) { Alert.alert('Playlist', e instanceof Error ? e.message : 'Operazione non riuscita'); }
    finally { if (mounted.current) setPlaylistBusy(false); }
  }
  async function prepareDelete() {
    if (deleteBusy) return;
    const songId = p.song.id;
    setDeleteBusy(true);
    try {
      const check = await request<{ title: string; artist: string; filename: string; token: string; expires: number }>('songs/' + encodeURIComponent(songId) + '/deletion');
      if (!mounted.current || activeSong.current !== songId) return;
      Alert.alert('Elimina dal server?', `${check.title}\n${check.artist}\n\nFile: ${check.filename}\n\nIl file sarà rimosso dalla libreria per tutti gli utenti e spostato nel cestino recuperabile del server.`, [{ text: 'Annulla', style: 'cancel' }, { text: 'Elimina dal server', style: 'destructive', onPress: () => void executeDelete(songId, check) }]);
    } catch (e) { Alert.alert('Eliminazione', e instanceof Error ? e.message : 'Impossibile verificare il file.'); }
    finally { if (mounted.current) setDeleteBusy(false); }
  }
  async function executeDelete(songId: string, check: { token: string; expires: number }) {
    setDeleteBusy(true);
    try {
      const result = await request<{ message: string; trashId: string }>('songs/' + encodeURIComponent(songId) + '/delete', 120000, { token: check.token, expires: check.expires });
      p.onDeleted(songId);
      Alert.alert('File nel cestino', result.message + '\n\nCodice recupero: ' + result.trashId);
    } catch (e) { Alert.alert('Eliminazione', e instanceof Error ? e.message : 'Operazione non riuscita.'); }
    finally { if (mounted.current) setDeleteBusy(false); }
  }

  const unavailable = (title: string) =>
    Alert.alert(title, 'Questa azione non è ancora collegata al backend dell’app.');

  const menuRow = (
    name: SFSymbol,
    label: string,
    action: () => void,
    destructive = false,
    subtitle?: string
  ) => (
    <Pressable onPress={action} style={menuStyles.row}>
      <View style={menuStyles.rowIcon}>
        <SymbolView
          name={name}
          size={15}
          weight="regular"
          tintColor={destructive ? '#ff453a' : menuText}
        />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={[
            menuStyles.rowLabel,
            { color: destructive ? '#ff453a' : menuText },
          ]}
        >
          {label}
        </Text>
        {!!subtitle && (
          <Text
            numberOfLines={1}
            style={[menuStyles.rowSubtitle, { color: menuSecondary }]}
          >
            {subtitle}
          </Text>
        )}
      </View>
    </Pressable>
  );

  const menuAction = (
    name: SFSymbol,
    label: string,
    action: () => void,
    disabled = false
  ) => (
    <Pressable
      disabled={disabled}
      onPress={action}
      style={[menuStyles.action, disabled && { opacity: 0.35 }]}
    >
      <SymbolView name={name} size={19} weight="medium" tintColor={menuText} />
      <Text
        numberOfLines={2}
        style={[menuStyles.actionLabel, { color: menuText }]}
      >
        {label}
      </Text>
    </Pressable>
  );

  const currentCover = coverURL(p.song.coverArt) ?? p.artworkUri;
  const upNext = queueMounted ? p.queue.slice(Math.max(0, p.index + 1)) : [];

  // Proportions measured from the supplied Apple Music reference screenshot
  // (735 x 1600). Keeping them as screen ratios makes the layout scale cleanly
  // across iPhone sizes.
  const referenceArtworkSize = Math.min(width * 0.705, height * 0.325);
  const referenceArtworkLeft = (width - referenceArtworkSize) / 2;
  const referenceArtworkTop = height * 0.164;
  const referenceMetaTop = height * 0.565;
  const referenceControlsTop = height * 0.642;
  const referenceSideInset = width * 0.067;

  const coverOpacity = queueProgress.interpolate({
    inputRange: [0, 0.42, 1],
    outputRange: [1, 0.36, 0],
  });
  const coverScale = queueProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0.18],
  });
  const coverTranslateX = queueProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -width * 0.36],
  });
  const coverTranslateY = queueProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -height * 0.20],
  });
  const queueOpacity = queueProgress.interpolate({
    inputRange: [0, 0.35, 1],
    outputRange: [0, 0.2, 1],
  });
  const queueTranslateY = queueProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [18, 0],
  });

  const toggleQueue = () => setMode(v => (v === 'queue' ? 'cover' : 'queue'));
  const toggleLyrics = () => setMode(v => (v === 'lyrics' ? 'cover' : 'lyrics'));

  return (
    <Modal
      visible={p.visible}
      transparent
      animationType="none"
      presentationStyle="overFullScreen"
      onRequestClose={() => dismissPlayer()}
    >
      <View style={playerStyles.modalRoot}>
        {p.connectivityBanner &&
          p.connectivityBannerOpacity &&
          p.connectivityBannerScale &&
          p.connectivityBannerY && (
            <View
              pointerEvents="none"
              style={playerStyles.connectivityBannerWrap}
            >
              <Animated.View
                style={[
                  playerStyles.connectivityBanner,
                  {
                    opacity: p.connectivityBannerOpacity,
                    transform: [
                      { translateY: p.connectivityBannerY },
                      { scale: p.connectivityBannerScale },
                    ],
                  },
                ]}
              >
                <View style={playerStyles.connectivityBannerIcon}>
                  <Ionicons
                    name={
                      p.connectivityBanner === 'offline'
                        ? 'cloud-offline-outline'
                        : 'checkmark-circle'
                    }
                    size={17}
                    color={
                      p.connectivityBanner === 'offline'
                        ? 'rgba(255,255,255,0.72)'
                        : '#ff375f'
                    }
                  />
                </View>

                <Text style={playerStyles.connectivityBannerTitle}>
                  {p.connectivityBanner === 'offline'
                    ? 'Sei offline'
                    : 'Di nuovo online'}
                </Text>
              </Animated.View>
            </View>
          )}

        <Reanimated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: '#000' },
            backdropAnimatedStyle,
          ]}
        />

        <Reanimated.View style={[playerStyles.sheet, playerAnimatedStyle]}>
          {/* Artwork-derived background. This gives both the player and the
              three-dot menu the same colour family without a native colour
              extraction dependency. */}
          <LinearGradient
            colors={['#56386d', '#291737', '#120c1d']}
            style={StyleSheet.absoluteFill}
          />

          {!!uri && (
            <Image
              source={{ uri }}
              blurRadius={24}
              resizeMode="cover"
              fadeDuration={0}
              style={[
                StyleSheet.absoluteFill,
                playerStyles.backgroundArtwork,
              ]}
            />
          )}

          <LinearGradient
            colors={[
              'rgba(0,0,0,0.05)',
              'rgba(39,16,55,0.24)',
              'rgba(16,10,30,0.61)',
              'rgba(10,8,20,0.84)',
            ]}
            locations={[0, 0.48, 0.74, 1]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={StyleSheet.absoluteFill}
          />

          {/* The grabber stays in the same position in cover and queue mode. */}
          <GestureDetector gesture={playerGesture}>
            <View style={[playerStyles.grabberHitArea, { top: height * 0.063 }]}>
              <View style={playerStyles.grabber} />
            </View>
          </GestureDetector>

          <View style={playerStyles.screen}>
            {mode === 'lyrics' ? (
              <View style={playerStyles.lyricsPane}>
                <View style={playerStyles.lyricsHeader}>
                  <Pressable
                    accessibilityLabel="Torna al player"
                    onPress={() => setMode('cover')}
                    style={playerStyles.headerRoundButton}
                  >
                    <SymbolView
                      name="chevron.down"
                      size={17}
                      weight="semibold"
                      tintColor={playerText}
                    />
                  </Pressable>
                  <Text style={playerStyles.lyricsTitle}>Testo</Text>
                  <View style={{ width: 40 }} />
                </View>

                {!p.lyrics ? (
                  <Text style={playerStyles.lyricsEmpty}>{p.lyricsMessage}</Text>
                ) : (
                  <ScrollView
                    ref={scroll}
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={playerStyles.lyricsContent}
                  >
                    <Text style={playerStyles.lyricsSource}>
                      {p.lyricsSource}
                    </Text>
                    {p.lyrics.line.map((line, i) => (
                      <Pressable
                        key={i}
                        disabled={!p.lyrics?.synced || line.start === undefined}
                        onLayout={e => {
                          positions.current[i] = e.nativeEvent.layout.y;
                        }}
                        onPress={() =>
                          seek(
                            ((line.start ?? 0) - (p.lyrics?.offset ?? 0)) / 1000
                          )
                        }
                      >
                        <Text
                          style={[
                            playerStyles.lyricLine,
                            {
                              opacity:
                                !p.lyrics?.synced || active === i ? 1 : 0.30,
                            },
                          ]}
                        >
                          {line.value || '♪'}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                )}
              </View>
            ) : (
              <>
                <View style={playerStyles.upperStage}>
                  {/* COVER VIEW ------------------------------------------------ */}
                  <Animated.View
                    pointerEvents={mode === 'queue' ? 'none' : 'auto'}
                    style={[
                      StyleSheet.absoluteFill,
                      playerStyles.coverPane,
                      {
                        opacity: coverOpacity,
                        transform: [
                          { translateX: coverTranslateX },
                          { translateY: coverTranslateY },
                          { scale: coverScale },
                        ],
                      },
                    ]}
                  >
                    {currentCover ? (
                      <Image
                        source={{ uri: currentCover }}
                        resizeMode="cover"
                        fadeDuration={0}
                        style={[
                          playerStyles.heroArtwork,
                          {
                            width: referenceArtworkSize,
                            height: referenceArtworkSize,
                            left: referenceArtworkLeft,
                            top: referenceArtworkTop,
                          },
                        ]}
                      />
                    ) : (
                      <View
                        style={[
                          playerStyles.heroFallback,
                          {
                            width: referenceArtworkSize,
                            height: referenceArtworkSize,
                            left: referenceArtworkLeft,
                            top: referenceArtworkTop,
                          },
                        ]}
                      >
                        <SymbolView
                          name="music.note"
                          size={96}
                          weight="regular"
                          tintColor={playerSecondary}
                        />
                      </View>
                    )}

                    <LinearGradient
                      pointerEvents="none"
                      colors={[
                        'rgba(0,0,0,0)',
                        'rgba(24,8,35,0.02)',
                        'rgba(35,13,53,0.55)',
                        'rgba(35,13,53,0.96)',
                      ]}
                      locations={[0.52, 0.70, 0.88, 1]}
                      style={StyleSheet.absoluteFill}
                    />

                    <View
                      style={[
                        playerStyles.coverMeta,
                        {
                          left: referenceSideInset,
                          right: referenceSideInset,
                          top: referenceMetaTop,
                        },
                      ]}
                    >
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text
                          numberOfLines={1}
                          style={playerStyles.coverTitle}
                        >
                          {p.song.title}
                        </Text>
                        <Text
                          numberOfLines={1}
                          style={playerStyles.coverArtist}
                        >
                          {p.song.artist}
                        </Text>
                      </View>

                      <Pressable
                        accessibilityLabel={
                          starred
                            ? 'Rimuovi dai preferiti'
                            : 'Aggiungi ai preferiti'
                        }
                        disabled={favoriteBusy}
                        onPress={() => void favorite()}
                        style={playerStyles.metaIconButton}
                      >
                        {favoriteBusy ? (
                          <ActivityIndicator color={playerText} size="small" />
                        ) : (
                          <SymbolView
                            name={starred ? 'star.fill' : 'star'}
                            size={21}
                            weight="medium"
                            tintColor={playerText}
                          />
                        )}
                      </Pressable>

                      <Pressable
                        accessibilityLabel="Altre opzioni"
                        onPress={() => (menu ? closeMenu() : openMenu())}
                        style={playerStyles.metaIconButton}
                      >
                        <SymbolView
                          name="ellipsis"
                          size={21}
                          weight="medium"
                          tintColor={playerText}
                        />
                      </Pressable>
                    </View>
                  </Animated.View>

                  {/* QUEUE VIEW ------------------------------------------------ */}
                  <Animated.View
                    pointerEvents={mode === 'queue' ? 'auto' : 'none'}
                    style={[
                      StyleSheet.absoluteFill,
                      playerStyles.queuePane,
                      {
                        opacity: queueOpacity,
                        transform: [{ translateY: queueTranslateY }],
                      },
                    ]}
                  >
                    {queueMounted && (
                      <>
                    <View style={playerStyles.queueHeader}>
                      {currentCover ? (
                        <Image
                          source={{ uri: currentCover }}
                          style={playerStyles.queueCurrentArtwork}
                        />
                      ) : (
                        <View style={playerStyles.queueCurrentFallback}>
                          <SymbolView
                            name="music.note"
                            size={18}
                            weight="medium"
                            tintColor={playerSecondary}
                          />
                        </View>
                      )}

                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text
                          numberOfLines={1}
                          style={playerStyles.queueCurrentTitle}
                        >
                          {p.song.title}
                        </Text>
                        <Text
                          numberOfLines={1}
                          style={playerStyles.queueCurrentArtist}
                        >
                          {p.song.artist}
                        </Text>
                      </View>

                      <Pressable
                        disabled={favoriteBusy}
                        onPress={() => void favorite()}
                        style={playerStyles.queueHeaderButton}
                      >
                        <SymbolView
                          name={starred ? 'star.fill' : 'star'}
                          size={20}
                          weight="medium"
                          tintColor={playerText}
                        />
                      </Pressable>

                      <Pressable
                        onPress={() => (menu ? closeMenu() : openMenu())}
                        style={playerStyles.queueHeaderButton}
                      >
                        <SymbolView
                          name="ellipsis"
                          size={20}
                          weight="medium"
                          tintColor={playerText}
                        />
                      </Pressable>
                    </View>

                    <View style={playerStyles.queuePills}>
                      <Pressable
                        onPress={p.onShuffle}
                        style={[
                          playerStyles.queuePill,
                          p.shuffle && playerStyles.queuePillSelected,
                        ]}
                      >
                        <SymbolView
                          name={'shuffle' as SFSymbol}
                          size={17}
                          weight="semibold"
                          tintColor={playerText}
                        />
                      </Pressable>

                      <Pressable
                        onPress={p.onRepeat}
                        style={[
                          playerStyles.queuePill,
                          p.repeat !== 'off' && playerStyles.queuePillSelected,
                        ]}
                      >
                        <View>
                          <SymbolView
                            name={'repeat' as SFSymbol}
                            size={17}
                            weight="semibold"
                            tintColor={playerText}
                          />
                          {p.repeat === 'one' && (
                            <Text style={playerStyles.repeatOne}>1</Text>
                          )}
                        </View>
                      </Pressable>

                      <Pressable
                        onPress={() => setAutoplay(v => !v)}
                        style={[
                          playerStyles.queuePill,
                          autoplay && playerStyles.queuePillSelected,
                        ]}
                      >
                        <SymbolView
                          name={'infinity' as SFSymbol}
                          size={21}
                          weight="semibold"
                          tintColor={playerText}
                        />
                      </Pressable>

                      <Pressable
                        onPress={() => setAutomix(v => !v)}
                        style={[
                          playerStyles.queuePill,
                          automix && playerStyles.queuePillSelected,
                        ]}
                      >
                        <SymbolView
                          name={'circle.lefthalf.filled' as SFSymbol}
                          size={18}
                          weight="semibold"
                          tintColor={playerText}
                        />
                      </Pressable>
                    </View>

                    <Text style={playerStyles.upNextHeading}>
                      Continua l’ascolto
                    </Text>

                    <ScrollView
                      showsVerticalScrollIndicator={false}
                      style={[
                        playerStyles.queueScroll,
                        {
                          maxHeight: QUEUE_ROW_HEIGHT * 5,
                          marginBottom: Math.max(
                            0,
                            height - referenceControlsTop + 4
                          ),
                        },
                      ]}
                      contentContainerStyle={playerStyles.queueListContent}
                    >
                      {upNext.length ? (
                        <View style={playerStyles.queueRowsContainer}>
                          <QueueDropPlaceholder
                            hoverIndex={queueHoverIndex}
                            dragging={queueDragging}
                          />

                          {upNext.map((song, localIndex) => {
                            const realIndex =
                              p.index + 1 + localIndex;

                            return (
                              <QueueDragRow
                                key={song.id}
                                song={song}
                                realIndex={realIndex}
                                localIndex={localIndex}
                                localCount={upNext.length}
                                minIndex={p.index + 1}
                                onSelect={p.onSelect}
                                onMove={p.onMoveQueueItem}
                                playerSecondary={playerSecondary}
                                activeIndex={queueDragIndex}
                                hoverIndex={queueHoverIndex}
                                dragY={queueDragY}
                                dragging={queueDragging}
                              />
                            );
                          })}
                        </View>
                      ) : (
                        <View style={playerStyles.queueEmpty}>
                          <Text style={playerStyles.queueEmptyTitle}>
                            Fine della coda
                          </Text>
                          <Text style={playerStyles.queueEmptyText}>
                            Non ci sono altri brani in riproduzione.
                          </Text>
                        </View>
                      )}
                    </ScrollView>

                    <LinearGradient
                      pointerEvents="none"
                      colors={[
                        'rgba(0,0,0,0)',
                        'rgba(0,0,0,0.08)',
                        'rgba(0,0,0,0.24)',
                        'rgba(0,0,0,0.46)',
                      ]}
                      locations={[0, 0.38, 0.72, 1]}
                      start={{ x: 0.5, y: 0 }}
                      end={{ x: 0.5, y: 1 }}
                      style={[
                        playerStyles.queueBottomFade,
                        {
                          top: referenceControlsTop - 78,
                        },
                      ]}
                    />
                      </>
                    )}
                  </Animated.View>
                </View>

                {/* Common lower controls remain fixed while cover/queue morphs. */}
                <View
                  style={[
                    playerStyles.controlStack,
                    {
                      top: referenceControlsTop,
                      paddingHorizontal: referenceSideInset,
                    },
                  ]}
                >
                  <View style={playerStyles.progressArea}>
                    <Range
                      value={Math.min(1, currentTime / (duration || 1))}
                      onChange={v => seek(v * duration)}
                      color="rgba(255,255,255,0.82)"
                      track="rgba(255,255,255,0.25)"
                      label="Posizione del brano"
                      height={4}
                    />
                    <View style={playerStyles.timeRow}>
                      <Text style={playerStyles.timeText}>
                        {clock(currentTime)}
                      </Text>
                      <View style={playerStyles.hapticsChip}>
                        <SymbolView
                          name={'hand.tap' as SFSymbol}
                          size={9}
                          weight="regular"
                          tintColor="rgba(255,255,255,0.48)"
                        />
                        <Text style={playerStyles.hapticsText}>
                          Feedback aptici in pausa
                        </Text>
                      </View>
                      <Text style={playerStyles.timeText}>
                        −{clock(remainingTime)}
                      </Text>
                    </View>
                  </View>

                  <View style={playerStyles.transportRow}>
                    <Pressable
                      accessibilityLabel="Brano precedente"
                      onPress={p.onPrevious}
                      style={playerStyles.transportButton}
                    >
                      <SymbolView
                        name="backward.fill"
                        size={32}
                        weight="regular"
                        tintColor={playerText}
                      />
                    </Pressable>

                    <ElasticPlayPauseButton
                      accessibilityLabel={
                        status.playing ? 'Pausa' : 'Riproduci'
                      }
                      onPress={p.onToggle}
                      playing={!!status.playing}
                      style={playerStyles.playButton}
                      variant="symbol"
                      size={41}
                      color={playerText}
                    />

                    <Pressable
                      accessibilityLabel="Brano successivo"
                      disabled={
                        p.index + 1 >= p.queue.length &&
                        p.repeat !== 'all' &&
                        !p.shuffle
                      }
                      onPress={p.onNext}
                      style={[
                        playerStyles.transportButton,
                        p.index + 1 >= p.queue.length &&
                          p.repeat !== 'all' &&
                          !p.shuffle && { opacity: 0.28 },
                      ]}
                    >
                      <SymbolView
                        name="forward.fill"
                        size={32}
                        weight="regular"
                        tintColor={playerText}
                      />
                    </Pressable>
                  </View>

                  <View style={playerStyles.volumeRow}>
                    <SymbolView
                      name="speaker.fill"
                      size={11}
                      weight="regular"
                      tintColor={playerSecondary}
                    />
                    <View style={{ flex: 1, justifyContent: 'center' }}>
                      {nativeSystemVolumeAvailable ? (
                        <SystemVolumeSlider
                          accessibilityLabel="Volume di sistema"
                          style={{ width: '100%', height: 34 }}
                        />
                      ) : (
                        <Range
                          value={volume}
                          onChange={v => {
                            p.player.volume = v;
                            setVolume(v);
                          }}
                          color="rgba(255,255,255,0.80)"
                          track="rgba(255,255,255,0.22)"
                          label="Volume del player"
                          height={5}
                        />
                      )}
                    </View>
                    <SymbolView
                      name="speaker.wave.3.fill"
                      size={14}
                      weight="regular"
                      tintColor={playerSecondary}
                    />
                  </View>

                  <View style={playerStyles.bottomToolbar}>
                    <Pressable
                      accessibilityLabel="Testo"
                      onPress={toggleLyrics}
                      style={playerStyles.bottomTool}
                    >
                      <SymbolView
                        name={'quote.bubble' as SFSymbol}
                        size={26}
                        weight="medium"
                        tintColor={playerSecondary}
                      />
                    </Pressable>

                    {nativeAirPlayAvailable ? (
                      <AirPlayButton
                        accessibilityLabel="AirPlay"
                        style={playerStyles.bottomTool}
                      />
                    ) : (
                      <Pressable
                        accessibilityLabel="AirPlay"
                        onPress={() =>
                          Alert.alert(
                            'AirPlay',
                            'AirPlay nativo è disponibile nella build iOS di Metronomy.'
                          )
                        }
                        style={playerStyles.bottomTool}
                      >
                        <SymbolView
                          name={'airplayaudio' as SFSymbol}
                          size={27}
                          weight="medium"
                          tintColor={playerSecondary}
                        />
                      </Pressable>
                    )}

                    <Pressable
                      accessibilityLabel={
                        mode === 'queue' ? 'Chiudi coda' : 'Mostra coda'
                      }
                      accessibilityState={{ selected: mode === 'queue' }}
                      onPress={toggleQueue}
                      style={[
                        playerStyles.bottomTool,
                        mode === 'queue' && playerStyles.bottomToolSelected,
                      ]}
                    >
                      <SymbolView
                        name={'list.bullet' as SFSymbol}
                        size={27}
                        weight="medium"
                        tintColor={
                          mode === 'queue' ? playerText : playerSecondary
                        }
                      />
                    </Pressable>
                  </View>
                </View>
              </>
            )}
          </View>

          {/* Apple Music-like contextual menu. */}
          {menu && (
            <>
              <Animated.View
                pointerEvents="none"
                style={[
                  StyleSheet.absoluteFill,
                  playerStyles.menuBackdrop,
                  { opacity: menuProgress },
                ]}
              />

              <Pressable
                accessibilityLabel="Chiudi menu"
                onPress={() => closeMenu()}
                style={StyleSheet.absoluteFill}
              />

              <Animated.View
                style={[
                  menuStyles.popover,
                  {
                    top: 58,
                    right: 10,
                    width: Math.min(248, width * 0.645),
                    maxHeight: Math.min(650, height * 0.77),
                    opacity: menuProgress,
                    transform: [
                      {
                        translateX: menuProgress.interpolate({
                          inputRange: [0, 1],
                          outputRange: [78, 0],
                        }),
                      },
                      {
                        translateY: menuProgress.interpolate({
                          inputRange: [0, 1],
                          outputRange: [152, 0],
                        }),
                      },
                      {
                        scale: menuProgress.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0.18, 1],
                        }),
                      },
                    ],
                  },
                ]}
              >
                {!!uri && (
                  <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                    <Image
                      source={{ uri }}
                      blurRadius={64}
                      resizeMode="cover"
                      style={[StyleSheet.absoluteFill, menuStyles.menuArtwork]}
                    />
                  </View>
                )}

                <GlassView
                  pointerEvents="none"
                  style={StyleSheet.absoluteFill}
                  glassEffectStyle="regular"
                  isInteractive={false}
                />

                <LinearGradient
                  pointerEvents="none"
                  colors={[
                    'rgba(74,31,91,0.38)',
                    'rgba(64,29,82,0.55)',
                    'rgba(42,22,61,0.78)',
                  ]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={StyleSheet.absoluteFill}
                />

                <View pointerEvents="none" style={[StyleSheet.absoluteFill, menuStyles.menuBorder]} />

                <ScrollView
                  bounces={false}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={menuStyles.scrollContent}
                >
                  {playlists !== null ? (
                    <View pointerEvents={playlistBusy ? 'none' : 'auto'}>
                      {menuRow(
                        'chevron.left',
                        'Indietro',
                        () => setPlaylists(null)
                      )}
                      <View style={menuStyles.separator} />
                      {menuRow(
                        'plus.circle',
                        'Nuova playlist',
                        () =>
                          Alert.prompt(
                            'Nuova playlist',
                            'Nome della playlist su Navidrome',
                            name => {
                              if (name?.trim())
                                void addPlaylist(undefined, name.trim());
                            }
                          )
                      )}
                      {playlists.map(item => (
                        <View key={item.id}>
                          <View style={menuStyles.separatorInset} />
                          {menuRow(
                            'music.note.list',
                            item.name,
                            () => void addPlaylist(item.id)
                          )}
                        </View>
                      ))}
                    </View>
                  ) : (
                    <>
<View style={menuStyles.actionRow}>
                        
                        {menuAction(
                          starred ? 'star.fill' : 'star',
                          starred
                            ? 'Rimuovi dai preferiti'
                            : 'Aggiungi ai preferiti',
                          () => {
                            closeMenu();
                            void favorite();
                          },
                          favoriteBusy
                        )}
                        {menuAction(
                          'square.and.arrow.up',
                          'Condividi',
                          () => share(p.song.title + ' — ' + p.song.artist)
                        )}
                      </View>

                      <View style={menuStyles.groupSeparator} />

                      <View style={menuStyles.downloadSlot}>
                        <View style={menuStyles.downloadShift}>
                          <LocalDownloadAction
                            song={p.song}
                            color={menuText}
                            beforeRemove={beforeRemoveLocal}
                            afterRemove={afterRemoveLocal}
                          />
                        </View>
                      </View>

                      <View style={menuStyles.separatorInset} />

                      {menuRow(
                        'pin',
                        'Metti brano in evidenza',
                        () => {
                          closeMenu();
                          p.onHighlight
                            ? p.onHighlight()
                            : unavailable('Metti brano in evidenza');
                        }
                      )}
                      <View style={menuStyles.separatorInset} />
                      {menuRow(
                        'music.note.list',
                        'Aggiungi alla playlist',
                        () => {
                          if (!playlistBusy) void choosePlaylist();
                        }
                      )}
                      <View style={menuStyles.separatorInset} />
                      {menuRow(
                        'antenna.radiowaves.left.and.right' as SFSymbol,
                        'Crea stazione',
                        () => {
                          closeMenu();
                          p.onCreateStation
                            ? p.onCreateStation()
                            : unavailable('Crea stazione');
                        }
                      )}
                      <View style={menuStyles.separatorInset} />
                      {menuRow(
                        'rectangle.stack',
                        'Vai all’album',
                        () => closeMenu(() => p.onBrowse('album')),
                        false,
                        p.song.album
                      )}
                      <View style={menuStyles.separatorInset} />
                      {menuRow(
                        'person.crop.circle',
                        'Vai all’artista',
                        () => closeMenu(() => p.onBrowse('artist')),
                        false,
                        p.song.artist
                      )}
                      <View style={menuStyles.separatorInset} />
                      {menuRow(
                        'info.circle',
                        'Visualizza info',
                        () => {
                          closeMenu();
                          p.onCredits ? p.onCredits() : void info();
                        }
                      )}
                      <View style={menuStyles.separatorInset} />
                      {menuRow(
                        'quote.bubble',
                        'Condividi testo',
                        () => {
                          const text =
                            p.lyrics?.line
                              ?.map(line => line.value)
                              .filter(Boolean)
                              .join('\n') ||
                            p.song.title + ' — ' + p.song.artist;
                          share(text);
                        }
                      )}
                      <View style={menuStyles.separatorInset} />
                      {menuRow(
                        'hand.thumbsdown',
                        'Meno suggerimenti',
                        () => {
                          closeMenu();
                          p.onLessLikeThis
                            ? p.onLessLikeThis()
                            : unavailable('Meno suggerimenti');
                        }
                      )}

                      <View style={menuStyles.groupSeparator} />

                      {menuRow(
                        'trash',
                        p.onRemoveFromLibrary
                          ? 'Elimina dalla libreria'
                          : 'Elimina dal server',
                        () => {
                          if (p.onRemoveFromLibrary) {
                            closeMenu();
                            p.onRemoveFromLibrary();
                          } else {
                            closeMenu();
                            void prepareDelete();
                          }
                        },
                        true
                      )}
                    </>
                  )}
                </ScrollView>
              </Animated.View>
            </>
          )}
        </Reanimated.View>
      </View>
    </Modal>
  );
}

const playerStyles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  connectivityBannerWrap: {
    position: 'absolute',
    top: 70,
    left: 14,
    right: 14,
    zIndex: 250,
    elevation: 250,
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
    backgroundColor: 'rgba(32,24,38,0.94)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  connectivityBannerIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  connectivityBannerTitle: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: -0.05,
  },
  sheet: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: '#21132f',
  },
  backgroundArtwork: {
    transform: [{ scale: 1.32 }],
    opacity: 0.72,
  },
  grabberHitArea: {
    position: 'absolute',
    zIndex: 50,
    top: 52,
    left: '36%',
    right: '36%',
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grabber: {
    width: 58,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.34)',
  },
  screen: {
    flex: 1,
  },
  upperStage: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  coverPane: {},
  heroArtwork: {
    position: 'absolute',
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.06)',
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 7 },
  },
  heroFallback: {
    position: 'absolute',
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  coverMeta: {
    position: 'absolute',
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  coverTitle: {
    color: '#fff',
    fontSize: 17,
    lineHeight: 21,
    fontWeight: '600',
    letterSpacing: -0.20,
  },
  coverArtist: {
    color: 'rgba(255,255,255,0.56)',
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '400',
    letterSpacing: -0.18,
  },
  metaIconButton: {
    width: 40,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },

  queuePane: {
    paddingTop: 88,
    paddingHorizontal: 29,
  },
  queueHeader: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  queueCurrentArtwork: {
    width: 51,
    height: 51,
    borderRadius: 6,
  },
  queueCurrentFallback: {
    width: 51,
    height: 51,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  queueCurrentTitle: {
    color: '#fff',
    fontSize: 15.5,
    lineHeight: 18,
    fontWeight: '600',
  },
  queueCurrentArtist: {
    color: 'rgba(255,255,255,0.52)',
    fontSize: 12.5,
    lineHeight: 15,
    marginTop: 2,
  },
  queueHeaderButton: {
    width: 36,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  queuePills: {
    height: 47,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 2,
  },
  queuePill: {
    flex: 1,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.09)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  queuePillSelected: {
    backgroundColor: 'rgba(218,197,255,0.62)',
  },
  repeatOne: {
    position: 'absolute',
    top: 4,
    left: 8,
    color: '#fff',
    fontSize: 7,
    fontWeight: '800',
  },
  upNextHeading: {
    color: '#fff',
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '600',
    marginTop: 4,
    marginBottom: 7,
  },
  queueScroll: {
    flex: 1,
  },
  queueListContent: {
    paddingBottom: 18,
  },
  queueBottomFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 82,
    zIndex: 4,
  },
  queueRowsContainer: {
    position: 'relative',
  },
  queueDropPlaceholder: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 5,
    height: 58,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.055)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.09)',
  },
  queueRow: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
  },
  queueRowMain: {
    flex: 1,
    minWidth: 0,
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  queueDragHandle: {
    width: 38,
    height: 68,
    alignItems: 'center',
    justifyContent: 'center',
  },
  queueEmpty: {
    minHeight: 112,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  queueEmptyTitle: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 13.5,
    lineHeight: 17,
    fontWeight: '600',
  },
  queueEmptyText: {
    color: 'rgba(255,255,255,0.42)',
    fontSize: 11.5,
    lineHeight: 15,
    marginTop: 4,
    textAlign: 'center',
  },
  queueArtwork: {
    width: 56,
    height: 56,
    borderRadius: 7,
  },
  queueArtworkFallback: {
    width: 56,
    height: 56,
    borderRadius: 7,
    backgroundColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  queueSongTitle: {
    color: '#fff',
    fontSize: 15.8,
    lineHeight: 19,
    fontWeight: '500',
  },
  queueSongArtist: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 12.5,
    lineHeight: 14,
    marginTop: 1,
  },

  controlStack: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  progressArea: {
    height: 47,
  },
  timeRow: {
    minHeight: 16,
    marginTop: -2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  timeText: {
    width: 42,
    color: 'rgba(255,255,255,0.34)',
    fontSize: 9.5,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  hapticsChip: {
    minHeight: 14,
    paddingHorizontal: 5,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.07)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  hapticsText: {
    color: 'rgba(255,255,255,0.40)',
    fontSize: 8.5,
    lineHeight: 11,
  },
  transportRow: {
    height: 120,
    paddingHorizontal: 31,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  transportButton: {
    width: 52,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButton: {
    width: 60,
    height: 76,
    alignItems: 'center',
    justifyContent: 'center',
  },
  volumeRow: {
    height: 69,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  bottomToolbar: {
    height: 54,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bottomTool: {
    width: 60,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomToolSelected: {
    backgroundColor: 'rgba(215,194,255,0.62)',
  },

  lyricsPane: {
    flex: 1,
    paddingTop: 58,
  },
  lyricsHeader: {
    height: 54,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerRoundButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lyricsTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  lyricsEmpty: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 18,
    paddingHorizontal: 28,
    paddingTop: 30,
  },
  lyricsContent: {
    paddingHorizontal: 27,
    paddingTop: 22,
    paddingBottom: 170,
  },
  lyricsSource: {
    color: 'rgba(255,255,255,0.46)',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 18,
  },
  lyricLine: {
    color: '#fff',
    fontSize: 30,
    lineHeight: 39,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginBottom: 22,
  },

  menuBackdrop: {
    backgroundColor: 'rgba(0,0,0,0.10)',
  },
});

const menuStyles = StyleSheet.create({
  popover: {
    position: 'absolute',
    zIndex: 100,
    borderRadius: 27,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.16)',
    shadowColor: '#000',
    shadowOpacity: 0.24,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
  },
  menuArtwork: {
    transform: [{ scale: 1.34 }],
    opacity: 0.96,
  },
  menuBorder: {
    borderRadius: 27,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.20)',
  },
  scrollContent: {
    paddingTop: 10,
    paddingBottom: 12,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 7,
    paddingBottom: 8,
  },
  action: {
    flex: 1,
    minHeight: 60,
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 5,
    paddingTop: 3,
    paddingHorizontal: 2,
  },
  actionLabel: {
    textAlign: 'center',
    fontSize: 9.5,
    lineHeight: 12,
    fontWeight: '500',
  },
  downloadSlot: {
    minHeight: 50,
    justifyContent: 'center',
    overflow: 'visible',
  },
  downloadShift: {
    // Same correction used by SongActions: LocalDownloadAction keeps its own
    // logic and internal layout, but its visible row is moved onto the menu grid.
    marginLeft: 17,
    marginRight: 20,
  },
  row: {
    minHeight: 50,
    paddingLeft: 16,
    paddingRight: 16,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowIcon: {
    width: 24,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  rowLabel: {
    fontSize: 14.5,
    lineHeight: 17,
    fontWeight: '400',
    letterSpacing: -0.12,
  },
  rowSubtitle: {
    marginTop: 1,
    fontSize: 10.5,
    lineHeight: 13,
    fontWeight: '400',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  separatorInset: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 50,
    marginRight: 16,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  groupSeparator: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 4,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
});

function Range({
  value,
  onChange,
  color,
  track,
  label,
  height = 5,
}: {
  value: number;
  onChange: (value: number) => void;
  color: string;
  track: string;
  label: string;
  height?: number;
}) {
  const width = useRef(1);
  const [drag, setDrag] = useState<number | null>(null);
  const position = (x: number) =>
    Math.min(1, Math.max(0, x / width.current));
  const shown = Math.min(1, Math.max(0, drag ?? value));

  return (
    <View
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(shown * 100) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={e =>
        onChange(
          Math.min(
            1,
            Math.max(
              0,
              value +
                (e.nativeEvent.actionName === 'increment' ? 0.05 : -0.05)
            )
          )
        )
      }
      onLayout={e => {
        width.current = e.nativeEvent.layout.width;
      }}
      onStartShouldSetResponder={() => true}
      onResponderGrant={e => setDrag(position(e.nativeEvent.locationX))}
      onResponderMove={e => setDrag(position(e.nativeEvent.locationX))}
      onResponderRelease={e => {
        onChange(position(e.nativeEvent.locationX));
        setDrag(null);
      }}
      onResponderTerminate={() => setDrag(null)}
      style={{ height: 28, justifyContent: 'center' }}
    >
      <View
        pointerEvents="none"
        style={{
          height,
          borderRadius: height / 2,
          overflow: 'hidden',
          backgroundColor: track,
        }}
      >
        <View
          style={{
            height,
            width: `${shown * 100}%`,
            backgroundColor: color,
          }}
        />
      </View>
    </View>
  );
}

import Pressable from './SpringPressable';
