import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  FlatList,
  Image,
  Pressable as RNPressable,
  ScrollView,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { GlassView } from 'expo-glass-effect';
import { request, coverURL, type Album, type Song } from './api';
import { useTheme } from './theme';
import { DownloadBadge, useOffline } from './OfflineDownloads';
import { preloadAlbumSongs } from './albumPrefetch';
import NowPlayingWaves from './NowPlayingWaves';

type Page = {
  title: string;
  endpoint: string;
  type: 'home' | 'albums' | 'songs' | 'artists' | 'playlists' | 'favorites' | 'downloads';
};

type Entry = {
  id: string;
  name: string;
  albumCount?: number;
  songCount?: number;
};

type Data = {
  albums?: Album[];
  songs?: Song[];
  artists?: Entry[];
  playlists?: Entry[];
  hasMore?: boolean;
  nextOffset?: number;
};

type AlbumOpenOrigin = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type Props = {
  onSettings: () => void;
  onPlay: (songs: Song[], index: number) => void;
  onAlbum: (album: Album, origin?: AlbumOpenOrigin) => void;
  onAlbumActions: (album: Album) => void;
  onActions: (song: Song) => void;
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  revision: number;
  currentId?: string;
  isPlaying?: boolean;
};

const root: Page = {
  title: 'Libreria',
  endpoint: 'albums?sort=newest',
  type: 'home',
};

const sections: {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  endpoint: string;
  type: Page['type'];
}[] = [
  { title: 'Playlist', icon: 'list', endpoint: 'library/playlists', type: 'playlists' },
  { title: 'Artisti', icon: 'mic-outline', endpoint: 'library/artists', type: 'artists' },
  { title: 'Album', icon: 'albums-outline', endpoint: 'albums?sort=alphabeticalByName', type: 'albums' },
  { title: 'Brani', icon: 'musical-note', endpoint: 'library/songs', type: 'songs' },
  { title: 'Preferiti', icon: 'star', endpoint: 'library/favorites', type: 'favorites' },
  { title: 'Scaricati', icon: 'arrow-down-circle-outline', endpoint: '', type: 'downloads' },
];

export default function LibraryScreen(p: Props) {
  const { store: offline, revision: offlineRevision } = useOffline('library');
  const { colors: c, isDark } = useTheme();
  const { width } = useWindowDimensions();
  const albumArtworkRefs = useRef<Record<string, any>>({});

  function measureAlbumOrigin(
    album: Album,
    node: any,
    after?: (origin?: AlbumOpenOrigin) => void
  ) {
    if (!node?.measureInWindow) {
      if (after) after();
      else p.onAlbum(album);
      return;
    }

    node.measureInWindow(
      (x: number, y: number, measuredWidth: number, measuredHeight: number) => {
        const origin =
          measuredWidth > 0 && measuredHeight > 0
            ? { x, y, width: measuredWidth, height: measuredHeight }
            : undefined;

        if (after) after(origin);
        else p.onAlbum(album, origin);
      }
    );
  }

  function openMeasuredAlbum(album: Album) {
    measureAlbumOrigin(album, albumArtworkRefs.current[album.id]);
  }

  const albumViewabilityConfig = useRef({
    itemVisiblePercentThreshold: 15,
    minimumViewTime: 30,
  }).current;

  const [stack, setStack] = useState<Page[]>([root]);
  const page = stack[stack.length - 1];

  const prefetchVisibleAlbums = useCallback(
    ({ viewableItems }: { viewableItems: Array<{ item: Album | Song | Entry }> }) => {
      if (page.type !== 'albums') return;

      for (const token of viewableItems) {
        const item = token.item as Album;
        if (item?.id) {
          void preloadAlbumSongs(item.id).catch(() => {});
        }
      }
    },
    [page.type]
  );

  const [data, setData] = useState<Data>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [sortMode, setSortMode] = useState<'default' | 'title' | 'artist'>('default');
  const [topMenu, setTopMenu] = useState<'filter' | 'sort' | 'page' | null>(null);
  const topMenuProgress = useRef(new Animated.Value(0)).current;
  const [artistDetail, setArtistDetail] = useState<Entry | null>(null);
  const [artistData, setArtistData] = useState<Data>({});
  const [artistBusy, setArtistBusy] = useState(false);
  const [artistError, setArtistError] = useState('');
  const [artistStarred, setArtistStarred] = useState(false);
  const artistProgress = useRef(new Animated.Value(0)).current;
  const artistClosing = useRef(false);

  const generation = useRef(0);
  const loadingMore = useRef(false);

  const push = (next: Page) => setStack(old => [...old, next]);

  useEffect(() => {
    setSortMode('default');
    setTopMenu(null);
    topMenuProgress.setValue(0);
  }, [page.endpoint, page.type, topMenuProgress]);

  useEffect(() => {
    const version = ++generation.current;

    setData({});
    setBusy(true);
    setError('');
    loadingMore.current = false;

    if (page.type === 'downloads') { setBusy(false); return; }

    const load = async () => {
      try {
        const result = await request<Data>(page.endpoint, 60000);

        if (version !== generation.current) return;

        if (page.type === 'favorites') {
          setData({
            ...result,
            songs: (result.songs ?? []).filter(song => !!song.starred),
          });
        } else {
          setData(result);
        }
      } catch (e) {
        if (version === generation.current) {
          setError(e instanceof Error ? e.message : 'Connessione non riuscita');
        }
      } finally {
        if (version === generation.current) setBusy(false);
      }
    };

    void load();

    return () => {
      generation.current++;
    };
  }, [page, retry, p.revision]);

  const albums = data.albums ?? [];
  const songs = page.type === 'downloads' ? Object.values(offline.tracks).sort((a, b) => b.savedAt - a.savedAt).map(t => t.song) : data.songs ?? [];
  const entries = data.artists ?? data.playlists ?? [];
  const grid = page.type === 'home' || page.type === 'albums';
  const songPage =
    page.type === 'songs' ||
    page.type === 'downloads' ||
    page.type === 'favorites';

  const collectionPage =
    page.type === 'albums' ||
    page.type === 'artists' ||
    page.type === 'playlists';

  const visibleSongs = songPage
    ? [...songs].sort((a, b) => {
        if (sortMode === 'title') {
          return a.title.localeCompare(b.title, 'it', { sensitivity: 'base' });
        }
        if (sortMode === 'artist') {
          const artistOrder = a.artist.localeCompare(b.artist, 'it', {
            sensitivity: 'base',
          });
          return artistOrder || a.title.localeCompare(b.title, 'it', {
            sensitivity: 'base',
          });
        }
        return 0;
      })
    : songs;

  const visibleAlbums = page.type === 'albums'
    ? [...albums].sort((a, b) => {
        if (sortMode === 'title') {
          return a.name.localeCompare(b.name, 'it', { sensitivity: 'base' });
        }

        if (sortMode === 'artist') {
          const artistA = a.artist ?? '';
          const artistB = b.artist ?? '';
          const artistOrder = artistA.localeCompare(artistB, 'it', {
            sensitivity: 'base',
          });

          return artistOrder || a.name.localeCompare(b.name, 'it', {
            sensitivity: 'base',
          });
        }

        return 0;
      })
    : albums;

  const visibleEntries = collectionPage && page.type !== 'albums'
    ? [...entries].sort((a, b) => {
        if (sortMode === 'title' || sortMode === 'artist') {
          return a.name.localeCompare(b.name, 'it', { sensitivity: 'base' });
        }

        return 0;
      })
    : entries;

  function playAll() {
    if (visibleSongs.length) p.onPlay(visibleSongs, 0);
  }

  function shuffleAll() {
    if (!visibleSongs.length) return;
    const shuffled = [...visibleSongs];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    p.onPlay(shuffled, 0);
  }

  function openArtist(entry: Entry) {
    setTopMenu(null);
    topMenuProgress.setValue(0);
    setArtistDetail(entry);
    setArtistData({});
    setArtistError('');
    setArtistBusy(true);
    setArtistStarred(false);
    artistClosing.current = false;
    artistProgress.setValue(0);

    requestAnimationFrame(() => {
      Animated.spring(artistProgress, {
        toValue: 1,
        damping: 24,
        stiffness: 250,
        mass: 0.82,
        useNativeDriver: true,
      }).start();
    });

    const version = ++generation.current;

    void request<Data>(
      'library/artists/' + encodeURIComponent(entry.id),
      60000
    )
      .then(result => {
        if (version === generation.current) {
          setArtistData(result);
        }
      })
      .catch(e => {
        if (version === generation.current) {
          setArtistError(
            e instanceof Error
              ? e.message
              : 'Impossibile aprire l’artista.'
          );
        }
      })
      .finally(() => {
        if (version === generation.current) {
          setArtistBusy(false);
        }
      });
  }

  function closeArtist(after?: () => void) {
    if (!artistDetail || artistClosing.current) return;

    artistClosing.current = true;

    Animated.timing(artistProgress, {
      toValue: 0,
      duration: 210,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) {
        artistClosing.current = false;
        return;
      }

      generation.current++;
      setArtistDetail(null);
      setArtistData({});
      setArtistError('');
      setArtistBusy(false);
      setArtistStarred(false);
      artistClosing.current = false;

      requestAnimationFrame(() => {
        after?.();
      });
    });
  }

  async function artistSongs() {
    const artistAlbums = artistData.albums ?? [];
    if (!artistAlbums.length) return [];

    const groups = await Promise.all(
      artistAlbums.map(album =>
        request<{ songs: Song[] }>(
          'albums/' + encodeURIComponent(album.id),
          60000
        ).catch(() => ({ songs: [] }))
      )
    );

    return groups.flatMap(group => group.songs ?? []);
  }

  function playArtist(shuffle = false) {
    if (artistBusy) return;

    setArtistBusy(true);

    void artistSongs()
      .then(songs => {
        if (!songs.length) {
          throw new Error('Nessun brano disponibile per questo artista.');
        }

        const queue = [...songs];

        if (shuffle) {
          for (let i = queue.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [queue[i], queue[j]] = [queue[j], queue[i]];
          }
        }

        p.onPlay(queue, 0);
      })
      .catch(e => {
        Alert.alert(
          'Artista',
          e instanceof Error
            ? e.message
            : 'Riproduzione non riuscita.'
        );
      })
      .finally(() => {
        setArtistBusy(false);
      });
  }

  function closeTopMenu(after?: () => void) {
    Animated.timing(topMenuProgress, {
      toValue: 0,
      duration: 145,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      setTopMenu(null);
      after?.();
    });
  }

  function openTopMenu(kind: 'filter' | 'sort' | 'page') {
    if (topMenu === kind) {
      closeTopMenu();
      return;
    }

    if (topMenu) {
      closeTopMenu(() => {
        topMenuProgress.setValue(0);
        setTopMenu(kind);
        requestAnimationFrame(() => {
          Animated.spring(topMenuProgress, {
            toValue: 1,
            damping: 20,
            stiffness: 255,
            mass: 0.72,
            useNativeDriver: true,
          }).start();
        });
      });
      return;
    }

    topMenuProgress.setValue(0);
    setTopMenu(kind);

    requestAnimationFrame(() => {
      Animated.spring(topMenuProgress, {
        toValue: 1,
        damping: 20,
        stiffness: 255,
        mass: 0.72,
        useNativeDriver: true,
      }).start();
    });
  }

  function changeSongView(type: 'songs' | 'favorites' | 'downloads') {
    const next: Page =
      type === 'songs'
        ? { title: 'Brani', endpoint: 'library/songs', type: 'songs' }
        : type === 'favorites'
          ? { title: 'Preferiti', endpoint: 'library/favorites', type: 'favorites' }
          : { title: 'Scaricati', endpoint: '', type: 'downloads' };

    closeTopMenu(() => {
      setStack(old => [...old.slice(0, -1), next]);
    });
  }

  function openSortMenu() {
    if (songPage || collectionPage) {
      openTopMenu('sort');
      return;
    }

    Alert.alert('Ordina', undefined, [
      {
        text: 'Ordine originale',
        onPress: () => setSortMode('default'),
      },
      {
        text: 'Titolo',
        onPress: () => setSortMode('title'),
      },
      {
        text: 'Artista',
        onPress: () => setSortMode('artist'),
      },
      { text: 'Annulla', style: 'cancel' },
    ]);
  }

  function openFilterMenu() {
    if (songPage) {
      openTopMenu('filter');
      return;
    }

    if (collectionPage) {
      openTopMenu('sort');
      return;
    }

    openSortMenu();
  }

  function openPageMenu() {
    if (songPage) {
      openTopMenu('sort');
      return;
    }

    if (collectionPage) {
      openTopMenu('page');
      return;
    }

    Alert.alert(page.title, undefined, [
      {
        text: 'Ordina',
        onPress: openSortMenu,
      },
      {
        text: 'Impostazioni',
        onPress: p.onSettings,
      },
      { text: 'Annulla', style: 'cancel' },
    ]);
  }

  async function more() {
    if (busy || loadingMore.current || !data.hasMore) return;

    loadingMore.current = true;
    setBusy(true);

    const version = generation.current;

    try {
      const offset = data.nextOffset ?? (grid ? albums.length : songs.length);

      const result = await request<Data>(
        page.endpoint +
          (page.endpoint.includes('?') ? '&' : '?') +
          'offset=' +
          offset,
        60000
      );

      if (version === generation.current) {
        setData(old => ({
          ...result,
          albums: [...(old.albums ?? []), ...(result.albums ?? [])],
          songs: [
            ...(old.songs ?? []),
            ...(
              page.type === 'favorites'
                ? (result.songs ?? []).filter(song => !!song.starred)
                : (result.songs ?? [])
            ),
          ],
        }));
      }
    } catch (e) {
      if (version === generation.current) {
        setError(e instanceof Error ? e.message : 'Connessione non riuscita');
      }
    } finally {
      if (version === generation.current) {
        setBusy(false);
        loadingMore.current = false;
      }
    }
  }

  const art = (
    id: string | undefined,
    size: number,
    nowPlaying = false
  ) => {
    const artwork = coverURL(id);

    return (
      <View
        style={{
          width: size,
          height: size,
          position: 'relative',
        }}
      >
        {artwork ? (
          <Image
            source={{ uri: artwork }}
            style={{
              width: size,
              height: size,
              borderRadius: 8,
              backgroundColor: c.surface,
            }}
          />
        ) : (
          <View
            style={{
              width: size,
              height: size,
              borderRadius: 8,
              backgroundColor: c.surface,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons
              name="musical-notes"
              size={size / 3}
              color={c.secondary}
            />
          </View>
        )}

        {nowPlaying && (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              right: 3,
              bottom: 3,
              width: 22,
              height: 22,
              borderRadius: 11,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(0,0,0,0.64)',
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: 'rgba(255,255,255,0.22)',
            }}
          >
            <NowPlayingWaves
              playing={!!p.isPlaying}
              color="#fff"
              size={14}
            />
          </View>
        )}
      </View>
    );
  };

  const header = (
    <View>
      {page.type === 'home' ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            marginTop: 8,
            marginBottom: 11,
          }}
        >
          <Text
            style={{
              flex: 1,
              color: c.text,
              fontSize: 31,
              lineHeight: 36,
              fontWeight: '800',
              letterSpacing: -0.9,
            }}
          >
            Libreria
          </Text>

          <Pressable
            accessibilityLabel="Apri impostazioni"
            onPress={p.onSettings}
            style={{
              width: 40,
              height: 40,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons
              name="person-circle-outline"
              color={c.accent}
              size={32}
            />
          </Pressable>
        </View>
      ) : (
        <>
          <View
            style={{
              minHeight: 54,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: 3,
              marginBottom: 16,
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={'Torna a ' + stack[stack.length - 2].title}
              onPress={() => setStack(old => old.slice(0, -1))}
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: c.surface,
                borderWidth: 0.5,
                borderColor: c.border,
              }}
            >
              <SymbolView
                name="chevron.left"
                size={21}
                weight="semibold"
                tintColor={c.text}
              />
            </Pressable>

            <View
              style={[
                topStyles.controlCapsule,
                {
                  backgroundColor: isDark
                    ? 'rgba(44,44,46,0.72)'
                    : 'rgba(238,238,240,0.78)',
                  borderColor: isDark
                    ? 'rgba(255,255,255,0.10)'
                    : 'rgba(0,0,0,0.08)',
                },
              ]}
            >
              <GlassView
                pointerEvents="none"
                glassEffectStyle="regular"
                isInteractive={false}
                style={StyleSheet.absoluteFill}
              />

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  songPage
                    ? 'Filtra brani'
                    : collectionPage
                      ? 'Ordina ' + page.title.toLowerCase()
                      : 'Ordina'
                }
                onPress={openFilterMenu}
                style={topStyles.controlButton}
              >
                <SymbolView
                  name="line.3.horizontal.decrease"
                  size={21}
                  weight="medium"
                  tintColor={c.text}
                />
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  songPage
                    ? 'Ordina brani'
                    : 'Altre opzioni'
                }
                onPress={openPageMenu}
                style={topStyles.controlButton}
              >
                <SymbolView
                  name="ellipsis"
                  size={23}
                  weight="semibold"
                  tintColor={c.text}
                />
              </Pressable>
            </View>
          </View>

          <Text
            style={{
              color: c.text,
              fontSize: 32,
              lineHeight: 38,
              fontWeight: '800',
              letterSpacing: -1.0,
              marginBottom: songPage ? 22 : 15,
            }}
          >
            {page.title}
          </Text>
        </>
      )}

      {page.type === 'home' && (
        <>
          <View style={{ marginTop: 1 }}>
            {sections.map(section => (
              <Pressable
                key={section.title}
                onPress={() => push(section)}
                accessibilityRole="button"
                style={{
                  minHeight: 49,
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingVertical: 8,
                  borderBottomWidth: 0.5,
                  borderColor: c.border,
                }}
              >
                <View
                  style={{
                    width: 32,
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginRight: 8,
                  }}
                >
                  <Ionicons
                    name={section.icon}
                    size={23}
                    color={c.accent}
                  />
                </View>

                <Text
                  style={{
                    flex: 1,
                    color: c.text,
                    fontSize: 17,
                    lineHeight: 21,
                    fontWeight: '400',
                    letterSpacing: -0.25,
                  }}
                >
                  {section.title}
                </Text>

                <Ionicons
                  name="chevron-forward"
                  color={c.secondary}
                  size={15}
                />
              </Pressable>
            ))}
          </View>

          <Text
            style={{
              color: c.text,
              fontSize: 21,
              lineHeight: 25,
              fontWeight: '700',
              letterSpacing: -0.45,
              marginTop: 25,
              marginBottom: 13,
            }}
          >
            Aggiunte recenti
          </Text>
        </>
      )}

      {songPage && (
        <View
          style={{
            flexDirection: 'row',
            gap: 12,
            marginBottom: 20,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Riproduci tutti i brani"
            disabled={!visibleSongs.length}
            onPress={playAll}
            style={{
              flex: 1,
              height: 46,
              borderRadius: 23,
              backgroundColor: c.surface,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 7,
              opacity: visibleSongs.length ? 1 : 0.45,
            }}
          >
            <SymbolView
              name="play.fill"
              size={17}
              weight="semibold"
              tintColor={c.accent}
            />
            <Text
              style={{
                color: c.accent,
                fontSize: 17,
                lineHeight: 21,
                fontWeight: '700',
                letterSpacing: -0.25,
              }}
            >
              Riproduci
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Riproduzione casuale"
            disabled={!visibleSongs.length}
            onPress={shuffleAll}
            style={{
              flex: 1,
              height: 46,
              borderRadius: 23,
              backgroundColor: c.surface,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 7,
              opacity: visibleSongs.length ? 1 : 0.45,
            }}
          >
            <SymbolView
              name="shuffle"
              size={20}
              weight="semibold"
              tintColor={c.accent}
            />
            <Text
              style={{
                color: c.accent,
                fontSize: 17,
                lineHeight: 21,
                fontWeight: '700',
                letterSpacing: -0.25,
              }}
            >
              Casuale
            </Text>
          </Pressable>
        </View>
      )}

      {!!error && (
        <Pressable
          onPress={() => setRetry(v => v + 1)}
          style={{ paddingVertical: 12 }}
        >
          <Text style={{ color: c.accent, fontSize: 14 }}>
            {error} · Riprova
          </Text>
        </Pressable>
      )}
    </View>
  );

  const filterMenu = topMenu === 'filter';
  const sortMenu = topMenu === 'sort';
  const pageMenu = topMenu === 'page';

  const topPopoverWidth = Math.min(244, Math.max(220, width - 132));

  const filterRow = (
    icon: SFSymbol,
    label: string,
    selected: boolean,
    action: () => void
  ) => (
    <Pressable
      accessibilityRole="button"
      onPress={action}
      style={topStyles.filterRow}
    >
      <View style={topStyles.checkSlot}>
        {selected && (
          <SymbolView
            name="checkmark"
            size={15}
            weight="semibold"
            tintColor={c.text}
          />
        )}
      </View>

      <View style={topStyles.menuIconSlot}>
        <SymbolView
          name={icon}
          size={18}
          weight="regular"
          tintColor={c.text}
        />
      </View>

      <Text
        numberOfLines={1}
        style={[topStyles.menuLabel, { color: c.text }]}
      >
        {label}
      </Text>
    </Pressable>
  );

  const sortRow = (
    label: string,
    value: 'default' | 'title' | 'artist',
    subtitle?: string
  ) => {
    const selected = sortMode === value;

    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          setSortMode(value);
          closeTopMenu();
        }}
        style={topStyles.sortRow}
      >
        <View style={topStyles.sortCheckSlot}>
          {selected && (
            <SymbolView
              name="checkmark"
              size={15}
              weight="semibold"
              tintColor={c.text}
            />
          )}
        </View>

        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            numberOfLines={1}
            style={[topStyles.menuLabel, { color: c.text }]}
          >
            {label}
          </Text>

          {!!subtitle && (
            <Text
              numberOfLines={1}
              style={[
                topStyles.menuSubtitle,
                { color: c.secondary },
              ]}
            >
              {subtitle}
            </Text>
          )}
        </View>
      </Pressable>
    );
  };

  const pageActionRow = (
    icon: SFSymbol,
    label: string,
    action: () => void
  ) => (
    <Pressable
      accessibilityRole="button"
      onPress={action}
      style={topStyles.pageActionRow}
    >
      <View style={topStyles.pageActionIcon}>
        <SymbolView
          name={icon}
          size={18}
          weight="regular"
          tintColor={c.text}
        />
      </View>

      <Text
        numberOfLines={1}
        style={[topStyles.menuLabel, { color: c.text }]}
      >
        {label}
      </Text>
    </Pressable>
  );

  return (
    <View style={{ flex: 1 }}>
      <FlatList<Album | Song | Entry>
      key={page.endpoint + ':' + grid}
      extraData={offlineRevision}
      data={grid ? visibleAlbums : songPage ? visibleSongs : visibleEntries}
      numColumns={grid ? 2 : 1}
      columnWrapperStyle={grid ? { gap: 12 } : undefined}
      style={{ flex: 1 }}
      contentContainerStyle={{
        paddingHorizontal: 18,
        paddingTop: 6,
        paddingBottom: 200,
      }}
      onScroll={p.onScroll}
      scrollEventThrottle={32}
      onViewableItemsChanged={prefetchVisibleAlbums}
      viewabilityConfig={albumViewabilityConfig}
      keyExtractor={(item, index) => item.id + ':' + index}
      ListHeaderComponent={header}
      ListEmptyComponent={
        !busy && !error ? (
          <Text
            style={{
              color: c.secondary,
              fontSize: 14,
              marginVertical: 18,
            }}
          >
            {page.type === 'downloads' ? !offline.ready ? 'Verifica dei download locali…' : offline.error || 'Nessun brano su questo iPhone. Usa ⋯ → Scarica su iPhone.' : page.type === 'favorites' ? 'I brani contrassegnati con la stella appariranno qui.' : 'Nessun elemento disponibile.'}
          </Text>
        ) : null
      }
      ListFooterComponent={
        <View>
          {busy && (
            <ActivityIndicator
              color={c.accent}
              style={{ margin: 18 }}
            />
          )}

          {data.hasMore && (
            <Pressable
              disabled={busy}
              onPress={() => void more()}
              style={{ paddingVertical: 14 }}
            >
              <Text
                style={{
                  color: c.accent,
                  fontSize: 14,
                  fontWeight: '500',
                }}
              >
                Carica altri
              </Text>
            </Pressable>
          )}
        </View>
      }
      renderItem={({ item, index }) => {
        if (grid) {
          const album = item as Album;
          const albumSize = (width - 48) / 2;

          return (
            <View
              style={{
                width: albumSize,
                marginBottom: 20,
              }}
            >
              <View
                ref={node => {
                  albumArtworkRefs.current[album.id] = node;
                }}
                collapsable={false}
              >
                <RNPressable
                  onPressIn={() => { void preloadAlbumSongs(album.id).catch(() => {}); }}
                  onPress={() => openMeasuredAlbum(album)}
                  accessibilityLabel={'Apri ' + album.name}
                >
                  {art(album.coverArt, albumSize)}
                </RNPressable>
              </View>

              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'flex-start',
                  marginTop: 6,
                }}
              >
                <RNPressable
                  onPressIn={() => { void preloadAlbumSongs(album.id).catch(() => {}); }}
                  onPress={() => openMeasuredAlbum(album)}
                  style={{ flex: 1, minWidth: 0 }}
                >
                  <Text
                    numberOfLines={1}
                    style={{
                      color: c.text,
                      fontSize: 14.5,
                      lineHeight: 18,
                      fontWeight: '500',
                      letterSpacing: -0.15,
                    }}
                  >
                    {album.name}
                  </Text>

                  <Text
                    numberOfLines={1}
                    style={{
                      color: c.secondary,
                      fontSize: 12.5,
                      lineHeight: 16,
                      marginTop: 1,
                    }}
                  >
                    {album.artist}
                  </Text>
                </RNPressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={'Opzioni album ' + album.name}
                  onPress={() => p.onAlbumActions(album)}
                  style={{
                    width: 35,
                    height: 35,
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginRight: -5,
                    marginTop: -3,
                  }}
                >
                  <Ionicons
                    name="ellipsis-horizontal"
                    color={c.secondary}
                    size={19}
                  />
                </Pressable>
              </View>
            </View>
          );
        }

        if (songPage) {
          const song = item as Song;
          const isCurrent = p.currentId === song.id;
          return (
            <View
              style={{
                minHeight: 53,
                flexDirection: 'row',
                alignItems: 'stretch',
              }}
            >
              <Pressable
                onPress={() => p.onPlay(visibleSongs, index)}
                accessibilityRole="button"
                accessibilityLabel={'Riproduci ' + song.title}
                style={{
                  width: 54,
                  alignItems: 'flex-start',
                  justifyContent: 'center',
                  paddingVertical: 4,
                }}
              >
                {art(song.coverArt, 44, isCurrent)}
              </Pressable>

              <View
                style={{
                  flex: 1,
                  minWidth: 0,
                  minHeight: 53,
                  flexDirection: 'row',
                  alignItems: 'center',
                  borderBottomWidth: 0.5,
                  borderColor: c.border,
                }}
              >
                <Pressable
                  onPress={() => p.onPlay(visibleSongs, index)}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    justifyContent: 'center',
                    paddingVertical: 6,
                    paddingRight: 5,
                  }}
                >
                  <Text
                    numberOfLines={1}
                    style={{
                      color: isCurrent ? c.accent : c.text,
                      fontSize: 16.5,
                      lineHeight: 20,
                      fontWeight: '500',
                      letterSpacing: -0.3,
                    }}
                  >
                    {song.title}
                  </Text>

                  <Text
                    numberOfLines={1}
                    style={{
                      color: c.secondary,
                      fontSize: 14,
                      lineHeight: 17,
                      marginTop: 1,
                      letterSpacing: -0.15,
                    }}
                  >
                    {song.artist}
                  </Text>
                </Pressable>

                <DownloadBadge song={song} />
                <Pressable
                  accessibilityLabel={'Opzioni per ' + song.title}
                  onPress={() => p.onActions(song)}
                  style={{
                    width: 42,
                    height: 50,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <SymbolView
                    name="ellipsis"
                    size={19}
                    weight="semibold"
                    tintColor={c.text}
                  />
                </Pressable>
              </View>
            </View>
          );
        }

        const entry = item as Entry;

        return (
          <Pressable
            onPress={() => {
              if (page.type === 'artists') {
                openArtist(entry);
                return;
              }

              push({
                title: entry.name,
                type: 'songs',
                endpoint:
                  'library/' +
                  page.type +
                  '/' +
                  encodeURIComponent(entry.id),
              });
            }}
            style={{
              minHeight: 54,
              flexDirection: 'row',
              alignItems: 'center',
              paddingVertical: 8,
              borderBottomWidth: 0.5,
              borderColor: c.border,
            }}
          >
            <View
              style={{
                width: 34,
                alignItems: 'center',
                justifyContent: 'center',
                marginRight: 7,
              }}
            >
              <Ionicons
                name={
                  page.type === 'artists'
                    ? 'person-circle-outline'
                    : 'list'
                }
                color={c.accent}
                size={26}
              />
            </View>

            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                numberOfLines={1}
                style={{
                  color: c.text,
                  fontSize: 16,
                  lineHeight: 20,
                  fontWeight: '400',
                  letterSpacing: -0.2,
                }}
              >
                {entry.name}
              </Text>

              <Text
                style={{
                  color: c.secondary,
                  fontSize: 12.5,
                  lineHeight: 15,
                  marginTop: 1,
                }}
              >
                {page.type === 'artists'
                  ? `${entry.albumCount ?? 0} album`
                  : `${entry.songCount ?? 0} brani`}
              </Text>
            </View>

            <Ionicons
              name="chevron-forward"
              color={c.secondary}
              size={15}
            />
          </Pressable>
        );
      }}
      />

      {artistDetail && (() => {
        const artistAlbums = artistData.albums ?? [];
        const avatar = coverURL(artistAlbums[0]?.coverArt);
        const cardWidth = Math.min(148, (width - 56) / 2);

        return (
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              artistStyles.overlay,
              {
                backgroundColor: c.background,
                opacity: artistProgress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.96, 1],
                }),
                transform: [
                  {
                    translateX: artistProgress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [width + 24, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            <SafeAreaView style={artistStyles.safeArea}>
              <View style={artistStyles.topBar}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Indietro"
                onPress={() => closeArtist()}
                style={[
                  artistStyles.circleButton,
                  {
                    backgroundColor: isDark
                      ? 'rgba(255,255,255,0.10)'
                      : 'rgba(0,0,0,0.06)',
                  },
                ]}
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
                  tintColor={c.text}
                />
              </Pressable>

              <View
                style={[
                  artistStyles.topActions,
                  {
                    backgroundColor: isDark
                      ? 'rgba(255,255,255,0.10)'
                      : 'rgba(0,0,0,0.06)',
                  },
                ]}
              >
                <GlassView
                  pointerEvents="none"
                  glassEffectStyle="regular"
                  isInteractive={false}
                  style={StyleSheet.absoluteFill}
                />

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    artistStarred
                      ? 'Rimuovi artista dai preferiti'
                      : 'Aggiungi artista ai preferiti'
                  }
                  onPress={() => setArtistStarred(v => !v)}
                  style={artistStyles.topAction}
                >
                  <SymbolView
                    name={artistStarred ? 'star.fill' : 'star'}
                    size={18}
                    weight="medium"
                    tintColor={c.text}
                  />
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Altre opzioni artista"
                  onPress={openPageMenu}
                  style={artistStyles.topAction}
                >
                  <SymbolView
                    name="ellipsis"
                    size={19}
                    weight="semibold"
                    tintColor={c.text}
                  />
                </Pressable>
              </View>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={artistStyles.content}
              onScroll={p.onScroll}
              scrollEventThrottle={32}
            >
              <View style={artistStyles.hero}>
                {avatar ? (
                  <Image
                    source={{ uri: avatar }}
                    resizeMode="cover"
                    style={artistStyles.avatar}
                  />
                ) : (
                  <View
                    style={[
                      artistStyles.avatar,
                      artistStyles.avatarFallback,
                      { backgroundColor: c.surface },
                    ]}
                  >
                    <SymbolView
                      name="person.fill"
                      size={29}
                      weight="medium"
                      tintColor={c.secondary}
                    />
                  </View>
                )}

                <View style={artistStyles.nameRow}>
                  <Text
                    numberOfLines={1}
                    style={[
                      artistStyles.name,
                      { color: c.text },
                    ]}
                  >
                    {artistDetail.name}
                  </Text>
                  <SymbolView
                    name="chevron.right"
                    size={14}
                    weight="semibold"
                    tintColor={c.secondary}
                  />
                </View>
              </View>

              <View style={artistStyles.actionRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Riproduci artista"
                  disabled={artistBusy}
                  onPress={() => playArtist(false)}
                  style={[
                    artistStyles.actionPill,
                    { backgroundColor: c.surface },
                  ]}
                >
                  {artistBusy ? (
                    <ActivityIndicator
                      size="small"
                      color={c.accent}
                    />
                  ) : (
                    <>
                      <SymbolView
                        name="play.fill"
                        size={13}
                        weight="semibold"
                        tintColor={c.accent}
                      />
                      <Text
                        style={[
                          artistStyles.actionText,
                          { color: c.accent },
                        ]}
                      >
                        Riproduci
                      </Text>
                    </>
                  )}
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Riproduzione casuale artista"
                  disabled={artistBusy}
                  onPress={() => playArtist(true)}
                  style={[
                    artistStyles.actionPill,
                    { backgroundColor: c.surface },
                  ]}
                >
                  <SymbolView
                    name="shuffle"
                    size={14}
                    weight="semibold"
                    tintColor={c.accent}
                  />
                  <Text
                    style={[
                      artistStyles.actionText,
                      { color: c.accent },
                    ]}
                  >
                    Casuale
                  </Text>
                </Pressable>
              </View>

              {!!artistError && (
                <View
                  style={[
                    artistStyles.notice,
                    { backgroundColor: c.surface },
                  ]}
                >
                  <Text style={{ color: c.text }}>
                    {artistError}
                  </Text>
                </View>
              )}

              {!artistBusy && !artistError && !artistAlbums.length && (
                <Text
                  style={[
                    artistStyles.empty,
                    { color: c.secondary },
                  ]}
                >
                  Nessun album disponibile.
                </Text>
              )}

                {!!artistAlbums.length && (
                  <View style={artistStyles.albumGrid}>
                    {artistAlbums.map(album => {
                      const artwork = coverURL(album.coverArt);

                      return (
                        <View
                          key={album.id}
                          style={{ width: cardWidth }}
                        >
                          <View
                            ref={node => {
                              albumArtworkRefs.current[album.id] = node;
                            }}
                            collapsable={false}
                          >
                            <RNPressable
                              accessibilityRole="button"
                              accessibilityLabel={'Apri album ' + album.name}
                              onPress={() => {
                                measureAlbumOrigin(
                                  album,
                                  albumArtworkRefs.current[album.id],
                                  origin =>
                                    closeArtist(() =>
                                      p.onAlbum(album, origin)
                                    )
                                );
                              }}
                            >
                              {artwork ? (
                                <Image
                                  source={{ uri: artwork }}
                                  resizeMode="cover"
                                  style={{
                                    width: cardWidth,
                                    height: cardWidth,
                                    borderRadius: 7,
                                  }}
                                />
                              ) : (
                                <View
                                  style={{
                                    width: cardWidth,
                                    height: cardWidth,
                                    borderRadius: 7,
                                    backgroundColor: c.surface,
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                  }}
                                >
                                  <SymbolView
                                    name="music.note"
                                    size={38}
                                    weight="regular"
                                    tintColor={c.secondary}
                                  />
                                </View>
                              )}
                            </RNPressable>
                          </View>

                          <Text
                            numberOfLines={2}
                            style={[
                              artistStyles.albumTitle,
                              { color: c.text },
                            ]}
                          >
                            {album.name}
                          </Text>

                          {!!album.year && (
                            <Text
                              style={[
                                artistStyles.albumYear,
                                { color: c.secondary },
                              ]}
                            >
                              {album.year}
                            </Text>
                          )}
                        </View>
                      );
                    })}
                  </View>
                )}
              </ScrollView>
            </SafeAreaView>
          </Animated.View>
        );
      })()}

      {topMenu && (songPage || collectionPage) && (
        <>
          <Pressable
            accessibilityLabel="Chiudi menu"
            onPress={() => closeTopMenu()}
            style={[StyleSheet.absoluteFill, topStyles.menuDismiss]}
          />

          <Animated.View
            style={[
              topStyles.popoverShadow,
              {
                top: 7,
                right: 18,
                width: topPopoverWidth,
                opacity: topMenuProgress,
                transform: [
                  {
                    translateX: topMenuProgress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [58, 0],
                    }),
                  },
                  {
                    translateY: topMenuProgress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-58, 0],
                    }),
                  },
                  {
                    scale: topMenuProgress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.26, 1],
                    }),
                  },
                ],
              },
            ]}
          >
            <View
              style={[
                topStyles.popoverClip,
                {
                  backgroundColor: isDark
                    ? 'rgba(31,31,33,0.72)'
                    : 'rgba(246,246,248,0.78)',
                  borderColor: isDark
                    ? 'rgba(255,255,255,0.13)'
                    : 'rgba(0,0,0,0.10)',
                },
              ]}
            >
              <GlassView
                pointerEvents="none"
                glassEffectStyle="regular"
                isInteractive={false}
                style={StyleSheet.absoluteFill}
              />

              {filterMenu && (
                <>
                  {filterRow(
                    'music.note',
                    'Tutti i brani',
                    page.type === 'songs',
                    () => changeSongView('songs')
                  )}

                  <View
                    style={[
                      topStyles.menuSeparator,
                      { backgroundColor: c.border },
                    ]}
                  />

                  {filterRow(
                    'star',
                    'Preferiti',
                    page.type === 'favorites',
                    () => changeSongView('favorites')
                  )}

                  <View
                    style={[
                      topStyles.menuSeparator,
                      { backgroundColor: c.border },
                    ]}
                  />

                  {filterRow(
                    'arrow.down.circle',
                    'Download',
                    page.type === 'downloads',
                    () => changeSongView('downloads')
                  )}
                </>
              )}

              {sortMenu && (
                <>
                  {songPage && (
                    <>
                      {sortRow('Titolo', 'title')}

                      <View
                        style={[
                          topStyles.menuSeparator,
                          { backgroundColor: c.border },
                        ]}
                      />

                      {sortRow(
                        'Data di aggiunta',
                        'default',
                        sortMode === 'default'
                          ? 'Più recenti prima'
                          : undefined
                      )}

                      <View
                        style={[
                          topStyles.menuSeparator,
                          { backgroundColor: c.border },
                        ]}
                      />

                      {sortRow('Artista', 'artist')}
                    </>
                  )}

                  {page.type === 'albums' && (
                    <>
                      {sortRow('Titolo', 'title')}

                      <View
                        style={[
                          topStyles.menuSeparator,
                          { backgroundColor: c.border },
                        ]}
                      />

                      {sortRow('Artista', 'artist')}

                      <View
                        style={[
                          topStyles.menuSeparator,
                          { backgroundColor: c.border },
                        ]}
                      />

                      {sortRow('Ordine originale', 'default')}
                    </>
                  )}

                  {(page.type === 'artists' || page.type === 'playlists') && (
                    <>
                      {sortRow(
                        page.type === 'artists' ? 'Nome artista' : 'Nome playlist',
                        'title'
                      )}

                      <View
                        style={[
                          topStyles.menuSeparator,
                          { backgroundColor: c.border },
                        ]}
                      />

                      {sortRow('Ordine originale', 'default')}
                    </>
                  )}
                </>
              )}

              {pageMenu && collectionPage && (
                <>
                  {pageActionRow(
                    'arrow.up.arrow.down',
                    'Ordina',
                    () => {
                      closeTopMenu(() => {
                        topMenuProgress.setValue(0);
                        setTopMenu('sort');

                        requestAnimationFrame(() => {
                          Animated.spring(topMenuProgress, {
                            toValue: 1,
                            damping: 20,
                            stiffness: 255,
                            mass: 0.72,
                            useNativeDriver: true,
                          }).start();
                        });
                      });
                    }
                  )}

                  <View
                    style={[
                      topStyles.menuSeparator,
                      { backgroundColor: c.border },
                    ]}
                  />

                  {pageActionRow(
                    'gearshape',
                    'Impostazioni',
                    () => closeTopMenu(p.onSettings)
                  )}
                </>
              )}
            </View>
          </Animated.View>
        </>
      )}
    </View>
  );
}

const artistStyles = StyleSheet.create({
  overlay: {
    zIndex: 70,
  },
  safeArea: {
    flex: 1,
  },
  topBar: {
    height: 54,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  circleButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topActions: {
    width: 86,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
  },
  topAction: {
    width: 43,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 170,
  },
  hero: {
    alignItems: 'center',
    paddingTop: 10,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameRow: {
    marginTop: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    maxWidth: '88%',
  },
  name: {
    fontSize: 19.5,
    lineHeight: 24,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  actionPill: {
    flex: 1,
    height: 39,
    borderRadius: 19.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  actionText: {
    fontSize: 13.5,
    lineHeight: 17,
    fontWeight: '600',
    letterSpacing: -0.15,
  },
  notice: {
    padding: 14,
    borderRadius: 13,
    marginTop: 18,
  },
  empty: {
    marginTop: 26,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  albumGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    marginTop: 20,
  },
  albumTitle: {
    marginTop: 7,
    fontSize: 11.5,
    lineHeight: 14,
    fontWeight: '500',
    letterSpacing: -0.1,
  },
  albumYear: {
    marginTop: 2,
    fontSize: 10.5,
    lineHeight: 13,
  },
});

const topStyles = StyleSheet.create({
  controlCapsule: {
    width: 108,
    height: 48,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  controlButton: {
    width: 54,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuDismiss: {
    zIndex: 80,
    backgroundColor: 'transparent',
  },
  popoverShadow: {
    position: 'absolute',
    zIndex: 100,
    borderRadius: 27,
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 20,
  },
  popoverClip: {
    borderRadius: 27,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  filterRow: {
    minHeight: 57,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  sortRow: {
    minHeight: 57,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  pageActionRow: {
    minHeight: 57,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  pageActionIcon: {
    width: 38,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  checkSlot: {
    width: 24,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  sortCheckSlot: {
    width: 25,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  menuIconSlot: {
    width: 29,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  menuLabel: {
    flexShrink: 1,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '400',
    letterSpacing: -0.22,
  },
  menuSubtitle: {
    marginTop: 1,
    fontSize: 11.5,
    lineHeight: 14,
    fontWeight: '400',
    letterSpacing: -0.08,
  },
  menuSeparator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 53,
    opacity: 0.75,
  },
});

import Pressable from './SpringPressable';
