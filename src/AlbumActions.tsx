import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Share } from 'react-native';
import FloatingMenu from './FloatingMenu';
import { MenuRow, MenuQuickActions, MenuQuickAction, MenuSeparator } from './MenuControls';
import { request, type Album, type Song } from './api';
import { useTheme } from './theme';
import { useOffline } from './OfflineDownloads';

type Props = { album: Album; onClose: () => void; onOpen: () => void; onPlay: (songs: Song[]) => void; onQueue: (songs: Song[]) => void; onDeleted: (ids: string[], complete: boolean) => void };
type Check = { title: string; artist: string; count: number; bytes: number; token: string; expires: number; warning?: string };

export default function AlbumActions(p: Props) {
  const { colors: c } = useTheme();
  const { store } = useOffline();
  const [busy, setBusy] = useState(false);
  const [albumSongs, setAlbumSongs] = useState<Song[] | null>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

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

  const close = (after?: () => void) => { p.onClose(); after?.(); };

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

  return <FloatingMenu onClose={p.onClose} busy={busy}>
    {busy && <ActivityIndicator color={c.text} style={{ padding: 12 }} />}
    <MenuQuickActions>
      <MenuQuickAction icon={albumFullyDownloaded ? 'checkmark.circle.fill' : 'arrow.down.circle.fill'} label={albumFullyDownloaded ? 'Scaricato' : 'Scarica'} onPress={downloadAlbum} disabled={busy} />
      <MenuQuickAction icon="play.fill" label="Riproduci" onPress={() => play()} disabled={busy} />
      <MenuQuickAction icon="square.and.arrow.up.fill" label="Condividi" onPress={() => void perform(async () => { await Share.share({ message: p.album.name + ' — ' + (p.album.artist ?? '') }); })} disabled={busy} />
    </MenuQuickActions>
    <MenuSeparator />
    <MenuRow icon="arrow.down.circle" label={albumDownloadLabel} subtitle={albumDownloadSubtitle} onPress={downloadAlbum} disabled={busy} />
    {hasLocalAlbumContent && <MenuRow icon="trash" label={albumRemoveLabel} subtitle={albumRemoveSubtitle} onPress={removeAlbumFromIPhone} destructive disabled={busy} />}
    <MenuSeparator />
    <MenuRow icon="text.line.last.and.arrowtriangle.forward" label="Aggiungi alla coda" onPress={() => play(true)} disabled={busy} />
    <MenuRow icon="square.stack" label="Apri album" onPress={() => close(p.onOpen)} disabled={busy} />
    <MenuRow icon="info.circle" label="Informazioni" onPress={info} disabled={busy} />
    <MenuSeparator />
    <MenuRow icon="trash" label="Elimina intero album dal server" onPress={remove} destructive disabled={busy} />
  </FloatingMenu>;
}
