import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Text, View } from 'react-native';
import Pressable from './SpringPressable';
import { request, coverURL, currentAccount, type Album } from './api';
import { useTheme } from './theme';
import { recentAlbums } from './listeningHistory';

export default function Discover({ scope, onAlbum, onQuery }: { scope: 'qobuz' | 'library'; onAlbum: (album: Album) => void; onQuery: (query: string) => void }) {
  const { colors: c } = useTheme();
  const [items, setItems] = useState<(Album & { cover?: string })[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true; setBusy(true); setItems([]); setError('');
    (async () => {
      try {
        let result = scope === 'library'
          ? (await request<{ albums: Album[] }>('library/recent')).albums
          : (await request<{ items: { id: string; title: string; artist: string; cover?: string }[] }>('network/discover', 35000)).items.map(i => ({ ...i, name: i.title }));
        if (scope === 'library') {
          const history = await recentAlbums().catch(() => []);
          const own = currentAccount()?.offline ? history.filter(a => result.some(b => b.id === a.id)) : history;
          result = [...own, ...result.filter(a => !own.some(b => b.id === a.id))].slice(0, 24);
        }
        if (active) setItems(result);
      } catch (e) { if (active) setError(e instanceof Error ? e.message : 'Non disponibile'); }
      finally { if (active) setBusy(false); }
    })();
    return () => { active = false; };
  }, [scope, revision]);
  return <View><View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20 }}><Text style={{ color: c.text, fontSize: 25, fontWeight: '700', flex: 1 }}>{scope === 'qobuz' ? 'Da scoprire' : 'Ascoltati di recente'}</Text><Pressable accessibilityLabel="Aggiorna suggerimenti" onPress={() => setRevision(v => v + 1)}><Text style={{ color: c.accent }}>Aggiorna</Text></Pressable></View>
    {scope === 'qobuz' && <Text style={{ color: c.secondary, marginBottom: 18 }}>Una selezione dai bestseller Qobuz</Text>}
    {busy ? <ActivityIndicator color={c.accent} /> : error ? <Text style={{ color: c.secondary }}>{error}</Text> : !items.length ? <Text style={{ color: c.secondary }}>Nessun ascolto registrato da Navidrome per questo account.</Text> : <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 22 }}>{items.map(item => <Pressable key={item.id} style={{ width: '46%' }} onPress={() => scope === 'library' ? onAlbum(item) : onQuery(item.name)} accessibilityLabel={item.name + ', ' + item.artist}>
      <Image source={{ uri: item.cover ?? coverURL(item.coverArt) }} style={{ width: '100%', aspectRatio: 1, borderRadius: 16, backgroundColor: c.surface }} />
      <Text numberOfLines={2} style={{ color: c.text, fontSize: 16, fontWeight: '600', marginTop: 10 }}>{item.name}</Text><Text numberOfLines={1} style={{ color: c.secondary, marginTop: 4 }}>{item.artist}</Text>
    </Pressable>)}</View>}
  </View>;
}
