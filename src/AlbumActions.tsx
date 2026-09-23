import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Modal, ScrollView, Share, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { GlassView } from 'expo-glass-effect';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { request, type Album, type Song } from './api';
import { useTheme } from './theme';
import { useOffline } from './OfflineDownloads';

type Props = { album: Album; onClose: () => void; onOpen: () => void; onPlay: (songs: Song[]) => void; onQueue: (songs: Song[]) => void; onDeleted: (ids: string[], complete: boolean) => void };
type Check = { title: string; artist: string; count: number; bytes: number; token: string; expires: number; warning?: string };

export default function AlbumActions(p: Props) {
  const { colors: c, isDark } = useTheme();
  const { width, height } = useWindowDimensions();
  const { store } = useOffline();
  const [busy, setBusy] = useState(false);
  const [albumSongs, setAlbumSongs] = useState<Song[] | null>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    mounted.current = true;
    progress.setValue(0);
    Animated.spring(progress, {
      toValue: 1,
      useNativeDriver: true,
      damping: 19,
      stiffness: 240,
      mass: 0.75,
    }).start();

    return () => {
      mounted.current = false;
    };
  }, [progress]);

  const endpoint = 'albums/' + encodeURIComponent(p.album.id);

  useEffect(() => {
    let active = true;

    void request<{ album?: Album; songs: Song[] }>(endpoint)
      .then(data => {
        if (active && mounted.current) {
          setAlbumSongs(Array.isArray(data.songs) ? data.songs : []);
        }
      })
      .catch(() => {
        // Il menu continua a funzionare: il caricamento verrà ritentato
        // quando l'utente sceglie "Scarica album su iPhone".
      });

    return () => {
      active = false;
    };
  }, [endpoint]);

  const close = (after?: () => void) => {
    if (pending.current) return;

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
    if (pending.current || !mounted.current) return;
    pending.current = true;
    setBusy(true);

    try {
      await action();
    } catch (e) {
      if (mounted.current) {
        Alert.alert('Album', e instanceof Error ? e.message : 'Operazione non riuscita.');
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function play(queue = false) {
    void perform(async () => {
      const data = await request<{ songs: Song[] }>(endpoint);

      if (!mounted.current) return;
      if (!data.songs.length) throw new Error('Nessun brano disponibile.');

      if (queue) p.onQueue(data.songs);
      else p.onPlay(data.songs);

      close();
    });
  }

  function downloadAlbum() {
    void perform(async () => {
      let songs = albumSongs;

      if (!songs) {
        const data = await request<{ album?: Album; songs: Song[] }>(endpoint);
        songs = Array.isArray(data.songs) ? data.songs : [];
        if (mounted.current) setAlbumSongs(songs);
      }

      if (!songs.length) {
        throw new Error('Nessun brano disponibile in questo album.');
      }

      const alreadyDownloaded = songs.filter(song => !!store.tracks[song.id]).length;
      const alreadyRunning = songs.filter(song => {
        const transfer = store.transfers[song.id];
        return !!transfer && transfer.state !== 'error';
      }).length;

      const toStart = songs.filter(song => {
        if (store.tracks[song.id]) return false;

        const transfer = store.transfers[song.id];
        if (transfer && transfer.state !== 'error') return false;

        return true;
      });

      if (!toStart.length) {
        if (alreadyDownloaded === songs.length) {
          Alert.alert(
            'Download album',
            'Tutti i brani di questo album sono già disponibili su questo iPhone.'
          );
        } else if (alreadyRunning > 0) {
          Alert.alert(
            'Download album',
            'Il download di questo album è già in corso.'
          );
        }

        return;
      }

      /*
       * OfflineStore serializza già i download tramite la propria coda interna.
       * Avviamo quindi tutti i brani qui: quelli già presenti vengono saltati
       * e i restanti verranno scaricati uno alla volta nell'ordine dell'album.
       */
      for (const song of toStart) {
        void store.download(song).catch(() => {
          // Gli errori di trasferimento vengono già esposti da OfflineStore
          // attraverso DownloadBadge / stato del singolo brano.
        });
      }

      Alert.alert(
        'Download album',
        toStart.length === 1
          ? '1 brano aggiunto ai download.'
          : `${toStart.length} brani aggiunti ai download.`
      );
    });
  }

  function removeAlbumFromIPhone() {
    if (!albumSongs?.length) {
      Alert.alert(
        'Download album',
        'Attendi il caricamento dei brani dell’album e riprova.'
      );
      return;
    }

    const downloaded = albumSongs.filter(song => !!store.tracks[song.id]);
    const running = albumSongs.filter(song => {
      const transfer = store.transfers[song.id];
      return !!transfer && transfer.state !== 'error';
    });

    if (!downloaded.length && !running.length) {
      Alert.alert(
        'Download album',
        'Non ci sono brani di questo album salvati o in download su questo iPhone.'
      );
      return;
    }

    const pieces: string[] = [];

    if (downloaded.length) {
      pieces.push(
        downloaded.length === 1
          ? '1 brano scaricato verrà rimosso'
          : `${downloaded.length} brani scaricati verranno rimossi`
      );
    }

    if (running.length) {
      pieces.push(
        running.length === 1
          ? '1 download in corso verrà annullato'
          : `${running.length} download in corso verranno annullati`
      );
    }

    Alert.alert(
      'Rimuovi album dall’iPhone?',
      `${pieces.join(' e ')}.\n\nL’album sul server e i preferiti resteranno invariati.`,
      [
        {
          text: 'Annulla',
          style: 'cancel',
        },
        {
          text: 'Rimuovi download',
          style: 'destructive',
          onPress: () => {
            void perform(async () => {
              /*
               * Prima annulliamo tutti i trasferimenti dell'album, inclusi
               * quelli ancora in coda. Poi eliminiamo soltanto le copie locali.
               * OfflineStore si occupa anche di file audio, copertina, indice
               * persistente e aggiornamento della UI.
               */
              for (const song of albumSongs) {
                const transfer = store.transfers[song.id];

                if (transfer && transfer.state !== 'error') {
                  await store.cancel(song.id).catch(() => {});
                }
              }

              let removed = 0;

              for (const song of albumSongs) {
                if (!store.tracks[song.id]) continue;

                await store.remove(song.id);
                removed++;
              }

              if (!mounted.current) return;

              Alert.alert(
                'Download album',
                removed === 1
                  ? '1 brano rimosso da questo iPhone.'
                  : `${removed} brani rimossi da questo iPhone.`
              );
            });
          },
        },
      ]
    );
  }

  function remove() {
    void perform(async () => {
      const check = await request<Check>(endpoint + '/deletion', 120000);

      if (!mounted.current) return;

      Alert.alert(
        'Elimina intero album dal server?',
        `${check.title}\n${check.artist}\n\n${check.count} file musicali · ${(check.bytes / 1048576).toFixed(1)} MB${check.warning ? '\n\n' + check.warning : ''}\n\nSaranno rimossi per tutti gli utenti che accedono a questa libreria e conservati nel cestino recuperabile. Copertine e altri file rimangono.`,
        [
          { text: 'Annulla', style: 'cancel' },
          {
            text: `Elimina ${check.count} brani`,
            style: 'destructive',
            onPress: () => void perform(async () => {
              let result: { status: string; removedSongIds: string[]; total: number; message: string };

              try {
                result = await request(endpoint + '/delete', 300000, {
                  token: check.token,
                  expires: check.expires,
                });
              } catch {
                throw new Error(
                  'Esito non confermato. Il server potrebbe avere già spostato alcuni file: verifica la libreria e il cestino prima di riprovare.'
                );
              }

              if (!mounted.current) return;

              p.onDeleted(result.removedSongIds, result.status === 'trashed');
              close();

              Alert.alert(
                result.status === 'trashed' ? 'Album nel cestino' : 'Rimozione interrotta',
                `${result.removedSongIds.length} di ${result.total} brani rimossi.\n\n${result.message}`
              );
            }),
          },
        ]
      );
    });
  }

  function info() {
    void perform(async () => {
      const data = await request<{ album: Album; songs: Song[] }>(endpoint);

      if (mounted.current) {
        Alert.alert(
          data.album.name,
          `${data.album.artist ?? ''}\n${data.songs.length} brani${data.album.year ? '\n' + data.album.year : ''}`
        );
      }
    });
  }

  const downloadedAlbumCount =
    albumSongs?.filter(song => !!store.tracks[song.id]).length ?? 0;

  const activeAlbumDownloads =
    albumSongs?.filter(song => {
      const transfer = store.transfers[song.id];
      return !!transfer && transfer.state !== 'error';
    }).length ?? 0;

  const albumFullyDownloaded =
    !!albumSongs?.length && downloadedAlbumCount === albumSongs.length;

  const albumDownloadLabel = albumFullyDownloaded
    ? 'Album scaricato su iPhone'
    : activeAlbumDownloads > 0
      ? 'Download album in corso'
      : 'Scarica album su iPhone';

  const albumDownloadSubtitle = albumSongs?.length
    ? albumFullyDownloaded
      ? `${albumSongs.length} brani disponibili offline`
      : activeAlbumDownloads > 0
        ? `${downloadedAlbumCount}/${albumSongs.length} scaricati · ${activeAlbumDownloads} in coda`
        : downloadedAlbumCount > 0
          ? `${downloadedAlbumCount}/${albumSongs.length} già scaricati`
          : `${albumSongs.length} brani`
    : undefined;

  const hasLocalAlbumContent =
    downloadedAlbumCount > 0 || activeAlbumDownloads > 0;

  const albumRemoveLabel =
    downloadedAlbumCount > 0
      ? 'Rimuovi album dall’iPhone'
      : 'Annulla download album';

  const albumRemoveSubtitle = albumSongs?.length
    ? downloadedAlbumCount > 0 && activeAlbumDownloads > 0
      ? `${downloadedAlbumCount} scaricati · ${activeAlbumDownloads} in download`
      : downloadedAlbumCount > 0
        ? downloadedAlbumCount === 1
          ? '1 brano salvato su questo iPhone'
          : `${downloadedAlbumCount} brani salvati su questo iPhone`
        : activeAlbumDownloads === 1
          ? '1 download in corso'
          : `${activeAlbumDownloads} download in corso`
    : undefined;

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
        if (!pending.current) close();
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
          disabled={busy}
          onPress={() => close()}
          accessibilityLabel="Chiudi opzioni album"
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
                {p.album.name}
              </Text>
              {!!p.album.artist && (
                <Text numberOfLines={1} style={[styles.artist, { color: c.secondary }]}>
                  {p.album.artist}
                </Text>
              )}
            </View>

            {busy && (
              <View style={styles.busy}>
                <ActivityIndicator color={c.text} size="small" />
                <Text style={[styles.busyText, { color: c.secondary }]}>Operazione in corso…</Text>
              </View>
            )}

            <View style={styles.actionRow}>
              {action('play.fill', 'Riproduci', () => play())}
              {action('text.badge.plus', 'Coda', () => play(true))}
              {action(
                'square.and.arrow.up',
                'Condividi',
                () => void perform(async () => {
                  await Share.share({
                    message: p.album.name + ' — ' + (p.album.artist ?? ''),
                  });
                })
              )}
            </View>

            <View style={[styles.groupSeparator, { backgroundColor: c.border }]} />

            {row(
              albumFullyDownloaded ? 'checkmark.circle' : 'arrow.down.circle',
              albumDownloadLabel,
              downloadAlbum,
              false,
              albumDownloadSubtitle
            )}

            {hasLocalAlbumContent && (
              <>
                <View style={[styles.separatorInset, { backgroundColor: c.border }]} />

                {row(
                  'trash',
                  albumRemoveLabel,
                  removeAlbumFromIPhone,
                  true,
                  albumRemoveSubtitle
                )}
              </>
            )}

            <View style={[styles.separatorInset, { backgroundColor: c.border }]} />

            {row('rectangle.stack', 'Apri album', () => close(() => p.onOpen()))}

            <View style={[styles.separatorInset, { backgroundColor: c.border }]} />

            {row('info.circle', 'Informazioni', info)}

            <View style={[styles.groupSeparator, { backgroundColor: c.border }]} />

            {row('trash', 'Elimina intero album dal server', remove, true)}
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
  row: {
    minHeight: 47,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  iconBox: {
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 7,
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
    marginLeft: 49,
  },
  groupSeparator: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 5,
  },
});

import Pressable from './SpringPressable';
