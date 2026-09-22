import { useRef, useState, useEffect } from 'react';
import { ActivityIndicator, Alert, Animated, Modal, ScrollView, Share, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { GlassView } from 'expo-glass-effect';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { request, type Song } from './api';
import { useTheme } from './theme';
import { LocalDownloadAction } from './OfflineDownloads';

type Props = { onRemoveLocal?: () => void; song: Song; onClose: () => void; onPlay: () => void; onQueue: () => void; onBrowse: (type: 'album' | 'artist') => void; onDeleted: (id: string) => void; onFavorite: (id: string, value: boolean) => void };

export default function SongActions(p: Props) {
  const { colors: c, isDark } = useTheme();
  const { width, height } = useWindowDimensions();
  const [busy, setBusy] = useState(false);
  const [star, setStar] = useState(!!p.song.starred);
  const [playlists, setPlaylists] = useState<{ id: string; name: string }[] | null>(null);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    progress.setValue(0);
    Animated.spring(progress, {
      toValue: 1,
      useNativeDriver: true,
      damping: 19,
      stiffness: 240,
      mass: 0.75,
    }).start();
  }, [progress]);

  const close = (after?: () => void) => {
    if (busy) return;

    Animated.timing(progress, {
      toValue: 0,
      duration: 130,
      useNativeDriver: true,
    }).start(() => {
      p.onClose();
      after?.();
    });
  };

  async function perform(action: () => Promise<void>) {
    if (busy) return;

    setBusy(true);

    try {
      await action();
    } catch (e) {
      Alert.alert('Brano', e instanceof Error ? e.message : 'Operazione non riuscita');
    } finally {
      setBusy(false);
    }
  }

  const favorite = () => void perform(async () => {
    const result = await request<{ starred: boolean }>(
      'songs/' + encodeURIComponent(p.song.id) + '/favorite',
      15000,
      { enabled: !star }
    );

    setStar(result.starred);
    p.onFavorite(p.song.id, result.starred);
  });

  const choosePlaylist = () => void perform(async () => {
    const data = await request<{ playlists: { id: string; name: string }[] }>('playlists');
    setPlaylists(data.playlists);
  });

  const addPlaylist = (id: string) => void perform(async () => {
    await request(
      'playlists/' + encodeURIComponent(id) + '/songs/' + encodeURIComponent(p.song.id),
      15000,
      {}
    );

    Alert.alert('Playlist', 'Brano aggiunto.');
    close();
  });

  const info = () => void perform(async () => {
    const data = await request<{ info: Record<string, unknown> }>(
      'songs/' + encodeURIComponent(p.song.id)
    );

    const labels: Record<string, string> = {
      genre: 'Genere',
      year: 'Anno',
      bitRate: 'Bitrate',
      samplingRate: 'Campionamento',
      bitDepth: 'Profondità',
      suffix: 'Formato',
      isrc: 'ISRC',
    };

    Alert.alert(
      p.song.title,
      p.song.artist +
        '\n' +
        (p.song.album ?? '') +
        '\n\n' +
        Object.entries(labels)
          .filter(([key]) => data.info[key] != null)
          .map(([key, name]) => name + ': ' + data.info[key])
          .join('\n')
    );
  });

  const remove = () => void perform(async () => {
    const check = await request<{
      title: string;
      artist: string;
      filename: string;
      token: string;
      expires: number;
    }>('songs/' + encodeURIComponent(p.song.id) + '/deletion');

    Alert.alert(
      'Elimina dal server?',
      `${check.title}\n${check.artist}\n${check.filename}\n\nRimosso per tutti gli utenti e conservato nel cestino recuperabile.`,
      [
        { text: 'Annulla', style: 'cancel' },
        {
          text: 'Elimina',
          style: 'destructive',
          onPress: () => void perform(async () => {
            const result = await request<{ trashId: string }>(
              'songs/' + encodeURIComponent(p.song.id) + '/delete',
              120000,
              { token: check.token, expires: check.expires }
            );

            p.onDeleted(p.song.id);
            close();

            Alert.alert('File nel cestino', 'Codice recupero: ' + result.trashId);
          }),
        },
      ]
    );
  });

  const row = (icon: SFSymbol, label: string, action: () => void, destructive = false, subtitle?: string) => (
    <Pressable disabled={busy} accessibilityRole="button" onPress={action} style={styles.row}>
      <View style={styles.iconBox}>
        <SymbolView
          name={icon}
          size={19}
          weight="regular"
          tintColor={destructive ? '#ff3b30' : c.text}
        />
      </View>

      <View style={{ flex: 1 }}>
        <Text
          numberOfLines={1}
          style={[styles.rowText, { color: destructive ? '#ff3b30' : c.text }]}
        >
          {label}
        </Text>

        {!!subtitle && (
          <Text numberOfLines={1} style={[styles.subtitle, { color: c.secondary }]}>
            {subtitle}
          </Text>
        )}
      </View>
    </Pressable>
  );

  const action = (icon: SFSymbol, label: string, onPress: () => void) => (
    <Pressable disabled={busy} onPress={onPress} style={styles.action}>
      <View style={[styles.actionCircle, { backgroundColor: isDark ? '#ffffff14' : '#0000000b' }]}>
        <SymbolView name={icon} size={23} weight="medium" tintColor={c.text} />
      </View>
      <Text numberOfLines={1} style={[styles.actionLabel, { color: c.text }]}>
        {label}
      </Text>
    </Pressable>
  );

  return (
    <Modal
      transparent
      animationType="none"
      onRequestClose={() => {
        if (!busy) close();
      }}
    >
      <View style={{ flex: 1 }}>
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: isDark ? '#0000004a' : '#0000002b',
              opacity: progress,
            },
          ]}
        />

        <Pressable
          accessibilityLabel="Chiudi opzioni"
          disabled={busy}
          onPress={() => close()}
          style={StyleSheet.absoluteFill}
        />

        <Animated.View
          style={[
            styles.popover,
            {
              right: 16,
              top: Math.max(105, height * 0.125),
              width: Math.min(292, width * 0.66),
              maxHeight: Math.min(560, height * 0.69),
              opacity: progress,
              transform: [
                {
                  translateY: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-7, 0],
                  }),
                },
                {
                  scale: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.94, 1],
                  }),
                },
              ],
            },
          ]}
        >
          <GlassView
            style={StyleSheet.absoluteFill}
            glassEffectStyle="regular"
            isInteractive={false}
          />

          <View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              {
                borderRadius: 24,
                backgroundColor: isDark
                  ? 'rgba(34,34,34,0.86)'
                  : 'rgba(248,248,248,0.90)',
              },
            ]}
          />

          <View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              {
                borderRadius: 24,
                borderWidth: 0.5,
                borderColor: isDark ? '#ffffff32' : '#ffffffd8',
              },
            ]}
          />

          <ScrollView
            bounces={false}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scroll}
          >
            <View style={styles.header}>
              <Text numberOfLines={1} style={[styles.title, { color: c.text }]}>
                {p.song.title}
              </Text>
              <Text numberOfLines={1} style={[styles.artist, { color: c.secondary }]}>
                {p.song.artist}
              </Text>
            </View>

            {busy && (
              <View style={styles.busy}>
                <ActivityIndicator color={c.text} size="small" />
                <Text style={[styles.busyText, { color: c.secondary }]}>Operazione in corso…</Text>
              </View>
            )}
{playlists ? (
              <>
                {row('chevron.left', 'Indietro', () => setPlaylists(null))}
                <View style={[styles.groupSeparator, { backgroundColor: c.border }]} />

                {playlists.map((item, index) => (
                  <View key={item.id}>
                    {index > 0 && (
                      <View style={[styles.separatorInset, { backgroundColor: c.border }]} />
                    )}
                    {row('music.note.list', item.name, () => addPlaylist(item.id))}
                  </View>
                ))}

                {!playlists.length && (
                  <Text style={[styles.emptyText, { color: c.secondary }]}>
                    Nessuna playlist modificabile. Puoi crearne una dal menu del player.
                  </Text>
                )}
              </>
            ) : (
              <>
                <View style={styles.actionRow}>
                  {action('play.fill', 'Riproduci', () => close(() => p.onPlay()))}
                  {action('text.badge.plus', 'Coda', () => {
                    p.onQueue();
                    close();
                  })}
                  {action(
                    'square.and.arrow.up',
                    'Condividi',
                    () => void perform(async () => {
                      await Share.share({ message: p.song.title + ' — ' + p.song.artist });
                    })
                  )}
                </View>

                <View style={[styles.groupSeparator, { backgroundColor: c.border }]} />

                <View style={styles.downloadSlot}>
                  <View style={styles.downloadShift}>
                    <LocalDownloadAction
                      song={p.song}
                      beforeRemove={p.onRemoveLocal}
                    />
                  </View>
                </View>

                <View style={[styles.separatorInset, { backgroundColor: c.border }]} />

                {row(
                  star ? 'star.fill' : 'star',
                  star ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti',
                  favorite
                )}

                <View style={[styles.separatorInset, { backgroundColor: c.border }]} />

                {row('music.note.list', 'Aggiungi alla playlist', choosePlaylist)}

                <View style={[styles.groupSeparator, { backgroundColor: c.border }]} />

                {row(
                  'rectangle.stack',
                  'Vai all’album',
                  () => close(() => p.onBrowse('album')),
                  false,
                  p.song.album
                )}

                <View style={[styles.separatorInset, { backgroundColor: c.border }]} />

                {row(
                  'person.crop.circle',
                  'Vai all’artista',
                  () => close(() => p.onBrowse('artist')),
                  false,
                  p.song.artist
                )}

                <View style={[styles.separatorInset, { backgroundColor: c.border }]} />

                {row('info.circle', 'Informazioni', info)}

                <View style={[styles.groupSeparator, { backgroundColor: c.border }]} />

                {row('trash', 'Elimina dal server', remove, true)}
              </>
            )}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  popover: {
    position: 'absolute',
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: 'transparent',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 18,
  },
  scroll: {
    paddingTop: 8,
    paddingBottom: 8,
  },
  header: {
    paddingHorizontal: 15,
    paddingTop: 8,
    paddingBottom: 10,
  },
  title: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  artist: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 15,
  },
  busy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 15,
    paddingVertical: 8,
  },
  busyText: {
    fontSize: 12,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-evenly',
    paddingHorizontal: 8,
    paddingTop: 3,
    paddingBottom: 10,
  },
  action: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    minWidth: 0,
  },
  actionCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: {
    marginTop: 5,
    fontSize: 10.5,
    lineHeight: 12,
    fontWeight: '500',
    letterSpacing: -0.15,
    maxWidth: 72,
    textAlign: 'center',
  },
  downloadSlot: {
    minHeight: 52,
    justifyContent: 'center',
    overflow: 'visible',
  },
  downloadShift: {
    marginLeft: 20,
    marginRight: 10,
    overflow: 'visible',
  },
  row: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 16,
    paddingRight: 16,
    paddingVertical: 6,
  },
  iconBox: {
    width: 30,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 11,
  },
  rowText: {
    fontSize: 15.5,
    lineHeight: 19,
    fontWeight: '500',
    letterSpacing: -0.2,
  },
  subtitle: {
    marginTop: 1,
    fontSize: 11.5,
    lineHeight: 14,
    fontWeight: '400',
  },
  separatorInset: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 57,
    marginRight: 16,
  },
  groupSeparator: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 5,
  },
  emptyText: {
    paddingHorizontal: 15,
    paddingVertical: 14,
    fontSize: 12,
    lineHeight: 16,
  },
});

import Pressable from './SpringPressable';
