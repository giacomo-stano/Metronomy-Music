import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Text, View } from 'react-native';
import Pressable from './SpringPressable';
import { request } from './api';
import { useTheme } from './theme';
type Summary = { songs: number; albums: number; artists: number; trashCount: number; trashBytes: number; canScan: boolean };
const size = (bytes: number) => bytes >= 1073741824 ? (bytes / 1073741824).toFixed(2) + ' GB' : (bytes / 1048576).toFixed(1) + ' MB';
export default function StorageSection() {
  const { colors: c } = useTheme();
  const [data, setData] = useState<Summary>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => { let active = true; setBusy(true); setError(''); request<Summary>('storage', 65000).then(d => { if (active) setData(d); }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setBusy(false); }); return () => { active = false; }; }, [revision]);
  async function scan() { setBusy(true); try { const result = await request<{ message: string }>('storage/scan', 30000, {}); Alert.alert('Quick scan', result.message); } catch (e) { Alert.alert('Scansione', String(e)); } finally { setBusy(false); } }
  async function empty() {
    setBusy(true);
    try {
      const confirmation = await request<{ count: number; bytes: number; expires: number; token: string }>('storage/trash/confirmation');
      if (!confirmation.count) { Alert.alert('Cestino vuoto', 'Nessun file eliminabile per questo account.'); return; }
      Alert.alert('Elimina definitivamente?', `${confirmation.count} file · ${size(confirmation.bytes)}\nNon potranno essere recuperati. Verranno eliminati solo i file del cestino autorizzati per questo account.`, [{ text: 'Annulla', style: 'cancel' }, { text: 'Elimina definitivamente', style: 'destructive', onPress: async () => {
        setBusy(true);
        try { const result = await request<{ message: string }>('storage/trash/empty', 120000, confirmation); Alert.alert('Cestino', result.message); } catch (e) { Alert.alert('Cestino', String(e)); } finally { setBusy(false); setRevision(v => v + 1); }
      } }]);
    } catch (e) { Alert.alert('Cestino', String(e)); } finally { setBusy(false); }
  }
  return <View style={{ marginTop: 28 }}><Text style={{ color: c.secondary, marginBottom: 12 }}>STORAGE · SERVER</Text><View style={{ padding: 18, borderRadius: 20, backgroundColor: c.surface }}>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>{(['songs', 'albums', 'artists'] as const).map((key, i) => <View key={key} style={{ alignItems: 'center' }}><Text style={{ color: c.text, fontSize: 28, fontWeight: '700' }}>{data?.[key] ?? '—'}</Text><Text style={{ color: c.secondary }}>{['Brani', 'Album', 'Artisti'][i]}</Text></View>)}</View>
    <Text style={{ color: c.secondary, marginTop: 16 }}>Catalogo Navidrome visibile al tuo account. Aggiorna dopo la scansione.</Text>
    <Text style={{ color: c.text, marginTop: 18 }}>Cestino: {data ? `${data.trashCount} file · ${size(data.trashBytes)}` : '—'}</Text>
    <Text style={{ color: c.secondary, fontSize: 12, marginTop: 6 }}>Backup incompleti, sconosciuti o non autorizzati vengono conservati.</Text>
    {!!error && <Text style={{ color: c.accent, marginTop: 12 }}>{error}</Text>}
    {busy && <ActivityIndicator color={c.accent} style={{ marginTop: 14 }} />}
    <Pressable disabled={busy} onPress={() => setRevision(v => v + 1)} style={{ paddingVertical: 14 }}><Text style={{ color: c.accent }}>Aggiorna riepilogo</Text></Pressable>
    <Pressable disabled={busy || !data?.canScan} onPress={() => void scan()} style={{ paddingVertical: 14 }}><Text style={{ color: data?.canScan ? c.accent : c.secondary }}>Quick scan{!data?.canScan ? ' · solo amministratore' : ''}</Text></Pressable>
    <Pressable disabled={busy || !data?.trashCount} onPress={() => void empty()} style={{ paddingVertical: 14 }}><Text style={{ color: data?.trashCount ? c.accent : c.secondary }}>Svuota definitivamente il cestino…</Text></Pressable>
  </View></View>;
}
