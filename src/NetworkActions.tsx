import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Share, Text, View } from 'react-native';
import FloatingMenu from './FloatingMenu';
import { MenuRow, MenuQuickActions, MenuQuickAction, MenuSeparator } from './MenuControls';
import { currentAccount, request } from './api';
import type { CatalogItem } from './networkCatalog';
import { useTheme } from './theme';
import { ServerDownloadBadge, useServerDownloads } from './ServerDownloads';
import { serverState, isServerComplete, type ServerJob } from './serverDownloadState';

export default function NetworkActions({ item, onClose, onPlay }: { item: CatalogItem; onClose: () => void; onPlay?: () => void }) {
  const { colors: c } = useTheme();
  const targets = currentAccount()?.destinations ?? [];
  const [destination, setDestination] = useState(targets.length === 1 ? targets[0].id : '');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const downloads = useServerDownloads();
  const state = serverState(item, downloads.jobs, downloads.pending, destination || undefined);
  const downloading = ['submitting', 'queued', 'downloading'].includes(state);
  const complete = isServerComplete(item);
  const waitingScan = item.kind === 'track' && state === 'completed';
  const missing = item.libraryTotalCount != null && item.libraryPresentCount != null ? item.libraryTotalCount - item.libraryPresentCount : null;
  async function download() {
    if (pending.current) return;
    if (complete) { Alert.alert('Già in libreria', 'Questo contenuto è già presente. Non verrà riscaricato.'); return; }
    if (downloading || waitingScan) { Alert.alert('Download sul server', waitingScan ? 'Download completato. Attendi la scansione di Navidrome.' : 'Questo contenuto è già in coda o in download.'); return; }
    if (!destination) { Alert.alert('Destinazione', 'Seleziona la libreria in cui scaricare.'); return; }
    pending.current = true;
    setBusy(true);
    const owner = currentAccount();
    try {
      await downloads.store.enqueue(item, destination, () => {
        if (currentAccount() !== owner) throw new Error('Account cambiato.');
        return request<ServerJob>('network/downloads', 100000, { kind: item.kind, id: item.id, destination });
      });
      onClose();
    } catch (error) { Alert.alert('Download sul server', error instanceof Error ? error.message : 'Operazione non riuscita'); }
    finally { pending.current = false; setBusy(false); }
  }
  const unavailable = !item.available && !item.libraryMatch;
  return <FloatingMenu onClose={onClose} busy={busy}>
    <MenuQuickActions>
      {item.kind !== 'artist' && <MenuQuickAction icon={complete ? 'checkmark.circle.fill' : 'arrow.down.circle.fill'} label={complete ? 'In libreria' : downloading ? 'In download' : item.kind === 'album' ? 'Scarica album' : 'Sul server'} onPress={() => void download()} disabled={busy || !item.available || downloading || waitingScan} />}
      {onPlay && item.kind !== 'artist' && <MenuQuickAction icon="play.fill" label="Riproduci" onPress={() => { onClose(); onPlay(); }} disabled={busy || unavailable} />}
      <MenuQuickAction icon="square.and.arrow.up.fill" label="Condividi" onPress={() => { void Share.share({ message: `https://open.qobuz.com/${item.kind}/${item.id}` }).catch(() => {}); }} disabled={busy} />
    </MenuQuickActions>
    {item.kind !== 'artist' && <>
      <MenuSeparator />
      {targets.length > 1 && <><Text style={{ color: c.secondary, paddingHorizontal: 23, paddingTop: 12 }}>Libreria di destinazione</Text>{targets.map(t => <MenuRow key={t.id} icon={destination === t.id ? 'checkmark.circle.fill' : 'circle'} label={t.label} onPress={() => setDestination(t.id)} disabled={busy} />)}<MenuSeparator /></>}
      <View style={{ paddingHorizontal: 23, paddingVertical: 8 }}><ServerDownloadBadge item={item} label /></View>
      <MenuRow icon={complete ? 'checkmark.circle' : 'arrow.down.circle'} label={complete ? 'Già nella tua libreria' : item.kind === 'album' ? 'Scarica album completo' : state === 'failed' ? 'Riprova download sul server' : 'Scarica sul server'} subtitle={complete ? 'Non verrà scaricato di nuovo' : item.kind === 'album' ? missing != null ? `Solo ${missing} brani mancanti; quelli presenti non verranno riscaricati` : 'Verifica e scarica soltanto i brani mancanti' : 'Disponibile dopo la scansione di Navidrome'} onPress={() => void download()} disabled={busy || !item.available || downloading || waitingScan} />
    </>}
    {busy && <ActivityIndicator color={c.accent} style={{ padding: 20 }} />}
  </FloatingMenu>;
}
