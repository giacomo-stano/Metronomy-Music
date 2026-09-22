import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  Animated,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle } from 'react-native-svg';

import Pressable from './SpringPressable';
import { OfflineStore } from './offlineStore';
import { useTheme } from './theme';
import { configureLocal, type Song } from './api';

const Context = createContext<OfflineStore | null>(null);

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

function ProgressRing({
  progress,
  color,
  track,
}: {
  progress: number;
  color: string;
  track: string;
}) {
  const value = useRef(new Animated.Value(progress)).current;
  const reduced = useRef(true);

  useEffect(() => {
    let active = true;

    AccessibilityInfo.isReduceMotionEnabled().then(v => {
      if (active) reduced.current = v;
    });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      v => {
        reduced.current = v;
      }
    );

    return () => {
      active = false;
      subscription.remove();
      value.stopAnimation();
    };
  }, [value]);

  useEffect(() => {
    if (reduced.current) {
      value.setValue(progress);
    } else {
      Animated.timing(value, {
        toValue: progress,
        duration: 140,
        useNativeDriver: false,
        isInteraction: false,
      }).start();
    }
  }, [progress, value]);

  return (
    <Svg width={24} height={24} viewBox="0 0 24 24">
      <Circle
        cx={12}
        cy={12}
        r={10}
        fill="none"
        stroke={track}
        strokeWidth={2}
      />

      <AnimatedCircle
        cx={12}
        cy={12}
        r={10}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeDasharray={[62.832, 62.832]}
        strokeDashoffset={value.interpolate({
          inputRange: [0, 1],
          outputRange: [62.832, 0],
        })}
        rotation={-90}
        origin="12,12"
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function OfflineProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => new OfflineStore());

  useLayoutEffect(() => {
    configureLocal({
      read: store.read,
      cover: store.cover,
    });

    return () => configureLocal();
  }, [store]);

  useEffect(() => () => store.dispose(), [store]);

  return <Context.Provider value={store}>{children}</Context.Provider>;
}

export function useOffline(scope: 'all' | 'library' = 'all') {
  const store = useContext(Context);

  if (!store) {
    throw new Error('OfflineProvider assente');
  }

  const revision = useSyncExternalStore(store.subscribe, scope === 'library' ? store.librarySnapshot : store.snapshot);

  return {
    store,
    revision,
  };
}

function useTrackOffline(id: string) {
  const store = useContext(Context);
  if (!store) throw new Error('OfflineProvider assente');
  useSyncExternalStore(store.subscribe, () => {
    const transfer = store.transfers[id];
    return JSON.stringify([store.ready, !!store.tracks[id], transfer?.state, transfer?.progress, transfer?.error]);
  });
  return store;
}

export function DownloadBadge({ song }: { song: Song }) {
  const store = useTrackOffline(song.id);
  const { colors: c } = useTheme();

  const transfer = store.transfers[song.id];

  if (store.tracks[song.id]) {
    return (
      <View
        accessible
        accessibilityLabel="Scaricato su questo iPhone"
        style={{
          width: 24,
          alignItems: 'center',
        }}
      >
        <Ionicons
          name="arrow-down-circle"
          size={16}
          color={c.secondary}
        />
      </View>
    );
  }

  if (!transfer) return null;

  if (transfer.state === 'error') {
    return (
      <Pressable
        accessibilityLabel="Download non riuscito"
        onPress={() =>
          Alert.alert(
            'Download',
            transfer.error ?? 'Riprova dal menu del brano.'
          )
        }
        style={{ padding: 6 }}
      >
        <Ionicons
          name="alert-circle-outline"
          size={20}
          color={c.accent}
        />
      </Pressable>
    );
  }

  return (
    <Pressable
      accessibilityLabel={
        transfer.state === 'queued'
          ? 'Download in coda. Tocca per annullare.'
          : 'Download in corso. Tocca per annullare.'
      }
      accessibilityRole="button"
      onPress={() =>
        void store.cancel(song.id).catch(() => {})
      }
      style={{
        width: 32,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {transfer.progress === null ? (
        <ActivityIndicator
          size="small"
          color={c.accent}
        />
      ) : (
        <ProgressRing
          progress={transfer.progress}
          color={c.accent}
          track={c.border}
        />
      )}

      {transfer.progress !== null && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            width: 7,
            height: 7,
            borderRadius: 1,
            backgroundColor: c.accent,
          }}
        />
      )}
    </Pressable>
  );
}

type LocalDownloadActionProps = {
  song: Song;
  beforeRemove?: () => void | Promise<void>;
  afterRemove?: () => void | Promise<void>;
  color?: string;
};

export function LocalDownloadAction({
  song,
  beforeRemove,
  afterRemove,
  color,
}: LocalDownloadActionProps) {
  const store = useTrackOffline(song.id);
  const { colors: c } = useTheme();

  const saved = !!store.tracks[song.id];
  const transfer = store.transfers[song.id];
  const running = !!transfer && transfer.state !== 'error';

  const act = () => {
    if (running) {
      void store
        .cancel(song.id)
        .catch(e =>
          Alert.alert(
            'Download',
            e instanceof Error ? e.message : String(e)
          )
        );

      return;
    }

    if (saved) {
      Alert.alert(
        'Rimuovi dall’iPhone?',
        'Verrà cancellata solo la copia locale. Il brano sul server e la stella dei preferiti resteranno invariati.',
        [
          {
            text: 'Annulla',
            style: 'cancel',
          },
          {
            text: 'Rimuovi download',
            style: 'destructive',
            onPress: () => {
              void (async () => {
                try {
                  /*
                   * Sequenza intenzionale:
                   * 1. il chiamante sgancia l'eventuale file locale dal player;
                   * 2. solo dopo viene cancellato fisicamente il download;
                   * 3. il chiamante può riagganciare la sorgente remota.
                   *
                   * Evita la race condition che si verificava quando
                   * beforeRemove() e store.remove() partivano contemporaneamente.
                   */
                  await beforeRemove?.();
                  await store.remove(song.id);
                  await afterRemove?.();
                } catch (e) {
                  Alert.alert(
                    'Download locale',
                    e instanceof Error ? e.message : String(e)
                  );
                }
              })();
            },
          },
        ]
      );

      return;
    }

    void store
      .download(song)
      .catch(e =>
        Alert.alert(
          'Download locale',
          e instanceof Error ? e.message : String(e)
        )
      );
  };

  return (
    <Pressable
      onPress={act}
      accessibilityRole="button"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 16,
      }}
    >
      <Ionicons
        name={
          saved
            ? 'phone-portrait-outline'
            : running
              ? 'stop-circle-outline'
              : 'arrow-down-circle-outline'
        }
        size={23}
        color={color ?? c.text}
      />

      <View style={{ flex: 1 }}>
        <Text
          style={{
            color: color ?? c.text,
            fontSize: 16,
          }}
        >
          {saved
            ? 'Rimuovi dall’iPhone'
            : running
              ? 'Annulla download'
              : 'Scarica su iPhone'}
        </Text>

        {transfer?.state === 'error' && (
          <Text
            style={{
              color: c.accent,
              fontSize: 12,
              marginTop: 4,
            }}
          >
            {transfer.error} · Tocca per riprovare
          </Text>
        )}
      </View>

      <DownloadBadge song={song} />
    </Pressable>
  );
}
