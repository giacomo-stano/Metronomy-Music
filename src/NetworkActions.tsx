import { useState } from 'react';
import { ActivityIndicator, Alert, Modal, Share, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Pressable from './SpringPressable';
import GlassBackground from './GlassBackground';
import { currentAccount, request } from './api';
import type { CatalogItem } from './networkCatalog';
import { useTheme } from './theme';

export default function NetworkActions({ item, onClose, onPlay, onDownloaded }: { item: CatalogItem; onClose: () => void; onPlay?: () => void; onDownloaded?: () => void }) {
  const { colors: c } = useTheme();
  const targets = currentAccount()?.destinations ?? [];
  const [destination, setDestination] = useState(targets.length === 1 ? targets[0].id : '');
  const [busy, setBusy] = useState(false);
  async function download() {
    if (item.libraryMatch) { Alert.alert('Già in libreria', 'Questo contenuto è già presente. Non verrà riscaricato.'); return; }
    if (!destination) { Alert.alert('Destinazione', 'Seleziona la libreria in cui scaricare.'); return; }
    setBusy(true);
    try {
      await request('network/downloads', 100000, { kind: item.kind, id: item.id, destination });
      onDownloaded?.(); onClose(); Alert.alert('Download sul server', 'Download aggiunto alla coda. Il brano sarà disponibile in Libreria dopo la scansione.');
    } catch (error) { Alert.alert('Download sul server', error instanceof Error ? error.message : 'Operazione non riuscita'); }
    finally { setBusy(false); }
  }
  const row = (title: string, icon: keyof typeof Ionicons.glyphMap, action: () => void, disabled = false) => <Pressable disabled={busy || disabled} onPress={action} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18, opacity: disabled ? 0.4 : 1, borderTopWidth: 0.5, borderColor: c.border }}><Ionicons name={icon} size={23} color={c.text} /><Text style={{ color: c.text, fontSize: 17, flex: 1 }}>{title}</Text></Pressable>;
  return <Modal transparent animationType="fade" onRequestClose={() => !busy && onClose()}><View style={{ flex: 1, justifyContent: 'center', padding: 28, backgroundColor: '#00000055' }}><Pressable accessibilityLabel="Chiudi opzioni" disabled={busy} onPress={onClose} style={{ position: 'absolute', inset: 0 }} /><View style={{ borderRadius: 30, overflow: 'hidden', borderWidth: 0.5, borderColor: c.border }}><GlassBackground /><View style={{ padding: 20 }}><Text style={{ color: c.text, fontWeight: '700', fontSize: 21 }}>{item.title}</Text><Text style={{ color: c.secondary, marginTop: 5 }}>{item.artist} · Qobuz</Text></View>
    {onPlay && item.kind === 'track' && row('Riproduci brano completo', 'play', () => { onClose(); onPlay(); }, !item.available && !item.libraryMatch)}
    {item.kind !== 'artist' && <>{targets.length > 1 && <View style={{ paddingHorizontal: 18, paddingBottom: 12 }}><Text style={{ color: c.secondary }}>Libreria di destinazione</Text>{targets.map(t => <Pressable key={t.id} disabled={busy} onPress={() => setDestination(t.id)} style={{ paddingVertical: 12 }}><Text style={{ color: destination === t.id ? c.accent : c.text }}>{destination === t.id ? '✓ ' : ''}{t.label}</Text></Pressable>)}</View>}{row(item.libraryMatch ? 'Già in libreria' : 'Scarica sul server', item.libraryMatch ? 'checkmark-circle' : 'arrow-down-circle-outline', () => void download(), !item.available && !item.libraryMatch)}</>}
    {row('Condividi', 'share-outline', () => { void Share.share({ message: `https://www.qobuz.com/${item.kind}/${item.id}` }).catch(() => {}); })}
    {busy ? <ActivityIndicator color={c.accent} style={{ padding: 20 }} /> : row('Chiudi', 'close', onClose)}
  </View></View></Modal>;
}
