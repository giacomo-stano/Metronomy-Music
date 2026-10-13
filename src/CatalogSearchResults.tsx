import { Image, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Pressable from './SpringPressable';
import { useTheme } from './theme';
import { searchItems, type CatalogItem } from './networkCatalog';

export default function CatalogSearchResults({ items, query, focused, onQuery, onOpen, onActions }: {
  items: CatalogItem[]; query: string; focused: boolean; onQuery: (value: string) => void;
  onOpen: (item: CatalogItem) => void; onActions: (item: CatalogItem) => void;
}) {
  const { colors: c } = useTheme();
  // Suggestions are real returned artist names, not invented autocomplete terms.
  const suggestions = [...new Set([query.trim(), ...items.filter(i => i.kind === 'artist').map(i => i.title)])].filter(Boolean).slice(0, 3);
  return <>
    {focused && suggestions.map(value => <Pressable key={value} onPress={() => onQuery(value)} accessibilityLabel={'Cerca ' + value} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 52 }}><Ionicons name="search-outline" size={23} color={c.text} /><View style={{ flex: 1, paddingVertical: 16, borderBottomWidth: 0.5, borderColor: c.border }}><Text numberOfLines={1} style={{ color: c.text, fontSize: 17 }}>{value}</Text></View></Pressable>)}
    {searchItems(items, query).map(item => <View key={item.kind + ':' + item.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Pressable onPress={() => onOpen(item)} accessibilityRole="button" accessibilityLabel={(item.kind === 'track' ? 'Riproduci ' : 'Apri ') + item.title} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, minHeight: 74 }}>
        {item.cover ? <Image source={{ uri: item.cover }} style={{ width: 56, height: 56, borderRadius: item.kind === 'artist' ? 28 : 5 }} /> : <View style={{ width: 56, height: 56, borderRadius: item.kind === 'artist' ? 28 : 5, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={item.kind === 'artist' ? 'person' : 'musical-notes'} size={26} color={c.secondary} /></View>}
        <View style={{ flex: 1 }}><Text numberOfLines={1} style={{ color: c.text, fontSize: 17 }}>{item.title}</Text><Text numberOfLines={1} style={{ color: c.secondary, fontSize: 15, marginTop: 3 }}>{item.kind === 'artist' ? 'Artista' : (item.kind === 'album' ? 'Album' : 'Brano') + ' · ' + item.artist}</Text>{item.libraryMatch && <Text style={{ color: c.secondary, fontSize: 11, marginTop: 2 }}>Già in libreria</Text>}</View>
      </Pressable>
      <Pressable onPress={() => item.kind === 'track' ? onActions(item) : onOpen(item)} accessibilityLabel={(item.kind === 'track' ? 'Opzioni per ' : 'Apri ') + item.title} style={{ width: 44, minHeight: 50, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={item.kind === 'track' ? 'ellipsis-horizontal' : 'chevron-forward'} size={item.kind === 'track' ? 23 : 19} color={item.kind === 'track' ? c.text : c.secondary} /></Pressable>
      <View pointerEvents="none" style={{ position: 'absolute', bottom: 0, left: 68, right: 0, height: 0.5, backgroundColor: c.border }} />
    </View>)}
  </>;
}
