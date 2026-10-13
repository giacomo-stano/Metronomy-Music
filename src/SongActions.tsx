import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Share, Text, View } from 'react-native';
import FloatingMenu from './FloatingMenu';
import { MenuRow, MenuQuickActions, MenuQuickAction, MenuSeparator } from './MenuControls';
import { request, type Song } from './api';
import { useTheme } from './theme';
import { LocalDownloadAction } from './OfflineDownloads';

type Props = { onRemoveLocal?: () => void; song: Song; onClose: () => void; onPlay: () => void; onQueue: () => void; onBrowse: (type: 'album' | 'artist') => void; onDeleted: (id: string) => void; onFavorite: (id: string, value: boolean) => void };

export default function SongActions(p: Props) {
  const { colors: c } = useTheme();
  const [busy, setBusy] = useState(false);
  const [star, setStar] = useState(!!p.song.starred);
  const [playlists, setPlaylists] = useState<{ id: string; name: string }[] | null>(null);
  const pending = useRef(false);
  const close = (after?: () => void) => { p.onClose(); after?.(); };

  async function perform(action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);

    try {
      await action();
    } catch (e) {
      Alert.alert('Brano', e instanceof Error ? e.message : 'Operazione non riuscita');
    } finally {
      pending.current = false;
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

  return <FloatingMenu onClose={p.onClose} busy={busy}>
    {busy && <ActivityIndicator color={c.text} style={{ padding: 12 }} />}
    {playlists ? <>
      <MenuRow icon="chevron.left" label="Indietro" onPress={() => setPlaylists(null)} disabled={busy} />
      <MenuSeparator />
      {playlists.map(item => <MenuRow key={item.id} icon="music.note.list" label={item.name} onPress={() => addPlaylist(item.id)} disabled={busy} />)}
      {!playlists.length && <Text style={{ color: c.secondary, padding: 22 }}>Nessuna playlist modificabile. Puoi crearne una dal menu del player.</Text>}
    </> : <>
      <MenuQuickActions>
        <LocalDownloadAction compact disabled={busy} song={p.song} beforeRemove={p.onRemoveLocal} />
        <MenuQuickAction icon={star ? 'star.slash' : 'star.fill'} label={star ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti'} onPress={favorite} disabled={busy} />
        <MenuQuickAction icon="square.and.arrow.up.fill" label="Condividi" onPress={() => void perform(async () => { await Share.share({ message: p.song.title + ' — ' + p.song.artist }); })} disabled={busy} />
      </MenuQuickActions>
      <MenuSeparator />
      <MenuRow icon="text.badge.plus" label="Aggiungi alla playlist" onPress={choosePlaylist} disabled={busy} />
      <MenuSeparator />
      <MenuRow icon="play.fill" label="Riproduci" onPress={() => close(p.onPlay)} disabled={busy} />
      <MenuRow icon="text.line.last.and.arrowtriangle.forward" label="Aggiungi alla coda" onPress={() => close(p.onQueue)} disabled={busy} />
      <MenuSeparator />
      <MenuRow icon="square.stack" label="Vai all’album" subtitle={p.song.album} onPress={() => close(() => p.onBrowse('album'))} disabled={busy} />
      <MenuRow icon="person.crop.circle" label="Vai all’artista" subtitle={p.song.artist} onPress={() => close(() => p.onBrowse('artist'))} disabled={busy} />
      <MenuRow icon="info.circle" label="Informazioni" onPress={info} disabled={busy} />
      <MenuSeparator />
      <MenuRow icon="trash" label="Elimina dal server" onPress={remove} destructive disabled={busy} />
    </>}
  </FloatingMenu>;
}
