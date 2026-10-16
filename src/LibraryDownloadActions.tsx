import { ActivityIndicator, Alert, Text, View } from 'react-native';
import { useOffline } from './OfflineDownloads';
import { MenuQuickAction, MenuQuickActions, MenuRow, MenuSeparator } from './MenuControls';
import { useTheme } from './theme';
import Pressable from './SpringPressable';
import { currentAccount } from './api';

export function LibraryDownloadStatus() {
  const { store } = useOffline('library');
  const { colors: c } = useTheme();
  const batch = store.bulk;
  if (!batch && !store.removingAll) return null;
  const running = batch?.state === 'reading' || batch?.state === 'downloading';
  const title = store.removingAll ? 'Rimozione download dall’iPhone…'
    : batch?.state === 'reading' ? `Preparazione libreria · ${batch.total} brani`
    : batch?.state === 'downloading' ? `Download · ${batch.completed + batch.skipped} di ${batch.total}`
    : batch?.state === 'error' ? 'Download interrotto'
    : batch?.state === 'cancelled' ? 'Download annullato' : 'Libreria scaricata';
  return <View style={{ paddingVertical: 14, gap: 8 }} accessibilityLiveRegion="polite">
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      {(running || store.removingAll) && <ActivityIndicator color={c.accent} />}
      <Text style={{ flex: 1, color: c.text, fontSize: 15, fontWeight: '600' }}>{title}</Text>
      {running && !store.removingAll && <Pressable accessibilityLabel="Annulla download della libreria" onPress={() => void store.cancelLibraryDownload().catch(() => {})} style={{ padding: 8 }}><Text style={{ color: c.accent }}>Annulla</Text></Pressable>}
    </View>
    {!!batch && !store.removingAll && <Text style={{ color: c.secondary, fontSize: 13 }}>{batch.error ?? `${batch.completed} nuovi · ${batch.skipped} già presenti · ${batch.failed} non riusciti`}</Text>}
    {batch?.state === 'downloading' && batch.total > 0 && <View accessible accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: batch.total, now: batch.completed + batch.skipped }} style={{ height: 3, borderRadius: 2, backgroundColor: c.border, overflow: 'hidden' }}><View style={{ height: 3, backgroundColor: c.accent, width: `${100 * (batch.completed + batch.skipped) / batch.total}%` }} /></View>}
  </View>;
}

export default function LibraryDownloadActions({ onClose, beforeRemove }: { onClose: () => void; beforeRemove: (ids: string[]) => Promise<void> }) {
  const { store } = useOffline('library');
  const running = store.bulk?.state === 'reading' || store.bulk?.state === 'downloading';
  const count = Object.keys(store.tracks).length;
  const error = (e: unknown) => Alert.alert('Download su iPhone', e instanceof Error ? e.message : 'Operazione non riuscita.');
  function download() {
    onClose();
    Alert.alert('Scarica tutti i brani su iPhone?', 'Verrà scaricata tutta la libreria del tuo account, saltando i brani già presenti su questo iPhone. Copertine e testi disponibili saranno salvati con la musica. Usa preferibilmente il Wi-Fi e tieni l’app aperta durante il download.', [
      { text: 'Annulla', style: 'cancel' },
      { text: 'Scarica tutti', onPress: () => void store.downloadLibrary().catch(error) },
    ]);
  }
  function remove() {
    onClose();
    Alert.alert('Rimuovi tutti i download?', `Saranno rimosse da questo iPhone tutte le copie locali del tuo account (${count} brani), incluse copertine e testi, e annullati i download in corso. La musica sul server e i preferiti non cambiano. L’eventuale brano locale in riproduzione verrà fermato.`, [
      { text: 'Annulla', style: 'cancel' },
      { text: 'Rimuovi download', style: 'destructive', onPress: () => void store.removeAll(beforeRemove).catch(error) },
    ]);
  }
  return <>
    <MenuQuickActions>
      <MenuQuickAction icon={running ? 'stop.circle.fill' : 'arrow.down.circle.fill'} label={running ? 'Annulla download' : 'Scarica tutti su iPhone'} disabled={!store.ready || store.removingAll || (!running && !!currentAccount()?.offline)} onPress={running ? () => { onClose(); void store.cancelLibraryDownload().catch(error); } : download} />
    </MenuQuickActions>
    <MenuSeparator />
    <MenuRow icon="trash" label="Rimuovi tutti i download" subtitle={`${count} brani su questo iPhone · il server non cambia`} destructive disabled={!store.ready || store.removingAll || (!count && !running && !Object.keys(store.transfers).length)} onPress={remove} />
    <MenuSeparator />
  </>;
}
