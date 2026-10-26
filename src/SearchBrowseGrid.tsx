import { Image, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Pressable from './SpringPressable';
import { ServerDownloadBadge } from './ServerDownloads';
import type { CatalogItem } from './networkCatalog';
import { browseTileMetrics } from './responsiveLayout';

const colors = ['#b02275', '#008f79', '#824ac7', '#c72d48', '#4576c5', '#a87a15', '#257877', '#8b4130'];
export default function SearchBrowseGrid({ items, onOpen, onActions }: {
  items: CatalogItem[]; onOpen: (item: CatalogItem) => void; onActions: (item: CatalogItem) => void;
}) {
  const { width, fontScale } = useWindowDimensions();
  const { singleColumn, minHeight } = browseTileMetrics(width, fontScale);
  return <View style={styles.grid}>{items.map((item, index) => <View key={item.kind + ':' + item.id} style={[styles.tile, singleColumn && { flexBasis: '100%', maxWidth: '100%' }, { minHeight, backgroundColor: colors[index % colors.length] }]}>
    <Pressable onPress={() => onOpen(item)} accessibilityRole="button"
      accessibilityLabel={(item.kind === 'track' ? 'Riproduci ' : 'Apri ') + item.title + ', ' + item.artist}
      style={styles.open}>
      {!!item.cover && <Image source={{ uri: item.cover }} resizeMode="cover" style={[StyleSheet.absoluteFill, { opacity: 0.65 }]} />}
      <LinearGradient pointerEvents="none" colors={['transparent', 'rgba(0,0,0,0.72)']} style={StyleSheet.absoluteFill} />
      <View style={{ padding: 11, paddingRight: 30, paddingTop: 44 }}>
        <Text numberOfLines={2} maxFontSizeMultiplier={1.5} style={{ color: '#fff', fontWeight: '700', fontSize: 17, lineHeight: 20 }}>{item.title}</Text>
        {!!item.artist && <Text numberOfLines={1} maxFontSizeMultiplier={1.5} style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 3 }}>{item.artist}</Text>}
      </View>
    </Pressable>
    <Pressable onPress={() => onActions(item)} accessibilityRole="button" accessibilityLabel={'Opzioni per ' + item.title}
      style={styles.options}><Ionicons name="ellipsis-horizontal" color="#fff" size={21} /></Pressable>
    <View style={styles.badge}><ServerDownloadBadge item={item} /></View>
  </View>)}</View>;
}
const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: '48.5%', flexGrow: 1, flexBasis: '46%', maxWidth: '49%', aspectRatio: 1.72, borderRadius: 12, overflow: 'hidden' },
  open: { flex: 1, justifyContent: 'flex-end' },
  options: { position: 'absolute', right: 0, top: 0, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.18)', borderBottomLeftRadius: 16 },
  badge: { position: 'absolute', bottom: 9, right: 5, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 12 },
});
