import { Image, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Pressable from './SpringPressable';
import { useTheme } from './theme';
import type { CatalogItem } from './networkCatalog';

export default function CatalogRows({ items, onOpen, onActions }: { items: CatalogItem[]; onOpen: (item: CatalogItem) => void; onActions: (item: CatalogItem) => void }) {
  const { colors: c } = useTheme();
  return <>{(['track', 'album', 'artist'] as const).map(kind => {
    const group = items.filter(item => item.kind === kind);
    if (!group.length) return null;
    return <View key={kind}><Text style={{ color: c.text, fontSize: 23, fontWeight: '700', marginTop: 18, marginBottom: 10 }}>{kind === 'track' ? 'Brani' : kind === 'album' ? 'Album' : 'Artisti'}</Text>{group.map(item => <View key={kind + ':' + item.id} style={{ flexDirection: 'row', alignItems: 'center', borderBottomWidth: 0.5, borderColor: c.border }}><Pressable accessibilityRole="button" accessibilityLabel={(kind === 'track' ? 'Riproduci ' : 'Apri ') + item.title} onPress={() => onOpen(item)} style={{ flex: 1, flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 12 }}>
      {item.cover ? <Image source={{ uri: item.cover }} style={{ width: 56, height: 56, borderRadius: kind === 'artist' ? 28 : 9 }} /> : <View style={{ width: 56, height: 56, borderRadius: kind === 'artist' ? 28 : 9, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={kind === 'artist' ? 'person' : 'musical-note'} size={24} color={c.secondary} /></View>}
      <View style={{ flex: 1 }}><Text numberOfLines={2} style={{ color: c.text, fontSize: 17 }}>{item.title}</Text><Text numberOfLines={1} style={{ color: c.secondary, marginTop: 4 }}>{kind === 'artist' ? 'Artista' : item.artist}</Text>{item.libraryMatch ? <Text style={{ color: c.accent, fontSize: 12, marginTop: 3 }}>Già in libreria</Text> : !item.available && <Text style={{ color: c.secondary, fontSize: 12 }}>Non disponibile</Text>}</View>
    </Pressable><Pressable onPress={() => onActions(item)} accessibilityRole="button" accessibilityLabel={'Opzioni per ' + item.title} style={{ padding: 14 }}><Ionicons name="ellipsis-horizontal" size={24} color={c.secondary} /></Pressable></View>)}</View>;
  })}</>;
}
