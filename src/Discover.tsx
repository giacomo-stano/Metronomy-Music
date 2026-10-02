import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Text, View } from 'react-native';
import Pressable from './SpringPressable';
import { request, coverURL, currentAccount, isConnectivityFailure, type Album } from './api';
import { useTheme } from './theme';
import { recentAlbums } from './listeningHistory';
import { listeningSeeds, useListeningRevision } from './listeningProfile';
import { ScreenCache } from './ScreenCache';
import CatalogRows from './CatalogRows';
import type { Catalog, CatalogItem } from './networkCatalog';
type Data = { albums: Album[]; catalog?: Catalog };

export default function Discover({ active: visible, revisionKey, scope, onAlbum, onOpen, onActions }: { active: boolean; revisionKey: string; scope: 'qobuz' | 'library'; onAlbum: (album: Album) => void; onOpen: (item: CatalogItem) => void; onActions: (item: CatalogItem) => void }) {
  const { colors: c } = useTheme();
  const [data, setData] = useState<Data>({ albums: [] });
  const [busy, setBusy] = useState(true), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  const profileRevision = useListeningRevision();
  const cache = useRef(new ScreenCache<Data>(2)).current;
  useEffect(() => {
    if (!visible) return;
    cache.useScope(revisionKey + ':' + revision + ':' + profileRevision);
    let active = true;
    const owner = currentAccount();
    const cached = cache.peek(scope);
    if (cached) { setData(cached); setBusy(false); setError(''); return; }
    setBusy(true); setError(''); setData({ albums: [] });
    void cache.get(scope, async () => {
      if (scope === 'qobuz') {
        const seeds = await listeningSeeds();
        // Never send a previous account's listening profile after a login change.
        if (currentAccount() !== owner) throw new Error('Account cambiato.');
        return { albums: [], catalog: await request<Catalog>('network/recommendations', 100000, { seeds }) };
      }
      const result = (await request<{ albums: Album[] }>('library/recent')).albums;
      const history = await recentAlbums().catch(() => []);
      const own = currentAccount()?.offline ? history.filter(a => result.some(b => b.id === a.id)) : history;
      return { albums: [...own, ...result.filter(a => !own.some(b => b.id === a.id))].slice(0, 24) };
    }).then(result => { if (active) setData(result); }).catch(e => { if (active) setError(isConnectivityFailure(e) ? 'Connessione non disponibile.' : e instanceof Error ? e.message : 'Non disponibile'); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [scope, revision, revisionKey, visible, cache, profileRevision]);
  return <View><View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20 }}><Text style={{ color: c.text, fontSize: 25, fontWeight: '700', flex: 1 }}>{scope === 'qobuz' ? 'Per te' : 'Ascoltati di recente'}</Text><Pressable accessibilityLabel="Aggiorna suggerimenti" onPress={() => setRevision(v => v + 1)}><Text style={{ color: c.accent }}>Aggiorna</Text></Pressable></View>
    {scope === 'qobuz' && !busy && !error && <Text style={{ color: c.secondary, marginBottom: 12 }}>{data.catalog?.personalized ? 'Dai generi che ascolti: ' + data.catalog.genres?.join(', ') : 'Non ho ancora abbastanza dati sui tuoi generi. Per ora, brani dai bestseller Qobuz.'}</Text>}
    {busy ? <ActivityIndicator color={c.accent} /> : error ? <Text style={{ color: c.secondary }}>{error}</Text> : scope === 'qobuz' ? data.catalog?.items.length ? <CatalogRows items={data.catalog.items} onOpen={onOpen} onActions={onActions} /> : <Text style={{ color: c.secondary }}>Nessun suggerimento disponibile. Riprova più tardi.</Text> : !data.albums.length ? <Text style={{ color: c.secondary }}>Nessun ascolto registrato per questo account.</Text> : <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 22 }}>{data.albums.map(item => <Pressable key={item.id} style={{ width: '46%' }} onPress={() => onAlbum(item)} accessibilityLabel={item.name + ', ' + item.artist}><Image source={{ uri: coverURL(item.coverArt) }} style={{ width: '100%', aspectRatio: 1, borderRadius: 16, backgroundColor: c.surface }} /><Text numberOfLines={2} style={{ color: c.text, fontSize: 16, fontWeight: '600', marginTop: 10 }}>{item.name}</Text><Text numberOfLines={1} style={{ color: c.secondary, marginTop: 4 }}>{item.artist}</Text></Pressable>)}</View>}
  </View>;
}
