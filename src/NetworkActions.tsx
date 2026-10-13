import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Share, Text, View } from 'react-native';
import FloatingMenu from './FloatingMenu';
import { MenuRow, MenuQuickActions, MenuQuickAction, MenuSeparator } from './MenuControls';
import { currentAccount, request } from './api';
import type { CatalogItem } from './networkCatalog';
import { useTheme } from './theme';

export default function NetworkActions({ item, onClose, onPlay, onDownloaded }: { item: CatalogItem; onClose: () => void; onPlay?: () => void; onDownloaded?: () => void }) {
  const { colors: c } = useTheme();
  const targets = currentAccount()?.destinations ?? [];
  const [destination, setDestination] = useState(targets.length === 1 ? targets[0].id : '');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  async function download() {
    if (pending.current) return;
    if (item.libraryMatch) { Alert.alert('Già in libreria', 'Questo contenuto è già presente. Non verrà riscaricato.'); return; }
    if (!destination) { Alert.alert('Destinazione', 'Seleziona la libreria in cui scaricare.'); return; }
    pending.current = true;
    setBusy(true);
    try {
      await request('network/downloads', 100000, { kind: item.kind, id: item.id, destination });
      onDownloaded?.(); onClose(); Alert.alert('Download sul server', 'Download aggiunto alla coda. Il brano sarà disponibile in Libreria dopo la scansione.');
    } catch (error) { Alert.alert('Download sul server', error instanceof Error ? error.message : 'Operazione non riuscita'); }
    finally { pending.current = false; setBusy(false); }
  }
  const unavailable = !item.available && !item.libraryMatch;
  return <FloatingMenu onClose={onClose} busy={busy}>
    <MenuQuickActions>
      {item.kind !== 'artist' && <MenuQuickAction icon={item.libraryMatch ? 'checkmark.circle.fill' : 'arrow.down.circle.fill'} label={item.libraryMatch ? 'In libreria' : 'Sul server'} onPress={() => void download()} disabled={busy || unavailable} />}
      {onPlay && item.kind !== 'artist' && <MenuQuickAction icon="play.fill" label="Riproduci" onPress={() => { onClose(); onPlay(); }} disabled={busy || unavailable} />}
      <MenuQuickAction icon="square.and.arrow.up.fill" label="Condividi" onPress={() => { void Share.share({ message: `https://open.qobuz.com/${item.kind}/${item.id}` }).catch(() => {}); }} disabled={busy} />
    </MenuQuickActions>
    {item.kind !== 'artist' && <>
      <MenuSeparator />
      {targets.length > 1 && <><Text style={{ color: c.secondary, paddingHorizontal: 23, paddingTop: 12 }}>Libreria di destinazione</Text>{targets.map(t => <MenuRow key={t.id} icon={destination === t.id ? 'checkmark.circle.fill' : 'circle'} label={t.label} onPress={() => setDestination(t.id)} disabled={busy} />)}<MenuSeparator /></>}
      <MenuRow icon={item.libraryMatch ? 'checkmark.circle' : 'arrow.down.circle'} label={item.libraryMatch ? 'Già nella tua libreria' : 'Scarica sul server'} subtitle={item.libraryMatch ? 'Non verrà scaricato di nuovo' : 'Disponibile dopo la scansione di Navidrome'} onPress={() => void download()} disabled={busy || unavailable} />
    </>}
    {busy && <ActivityIndicator color={c.accent} style={{ padding: 20 }} />}
  </FloatingMenu>;
}
