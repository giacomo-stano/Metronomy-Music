import { type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import Pressable from './SpringPressable';
import { useTheme } from './theme';
import { musicChrome } from './musicChrome';
import { MenuGroup, useNativeMenuEntry } from './NativeMenuContext';

export function MenuRow({ icon, label, subtitle, onPress, disabled, destructive, selected }: { icon: SFSymbol; label: string; subtitle?: string; onPress: () => void; disabled?: boolean; destructive?: boolean; selected?: boolean }) {
  const { colors: c } = useTheme();
  const native = useNativeMenuEntry({ kind: 'row', icon, label, subtitle, disabled, destructive, selected }, onPress);
  if (native) return null;
  const color = destructive ? c.accent : c.text;
  return <Pressable feedback="highlight" accessibilityRole="button" accessibilityState={{ disabled: !!disabled, selected }} disabled={disabled} onPress={onPress} style={({ pressed }) => [menuStyles.row, { opacity: disabled ? 0.4 : 1, backgroundColor: pressed ? c.border : 'transparent' }]}>
    <SymbolView name={icon} size={22} tintColor={color} style={{ width: 25 }} />
    <View style={{ flex: 1 }}><Text style={[menuStyles.label, { color }]}>{label}</Text>{!!subtitle && <Text style={[menuStyles.subtitle, { color: c.secondary }]}>{subtitle}</Text>}</View>
    {selected && <SymbolView name="checkmark" size={18} tintColor={color} />}
  </Pressable>;
}
export function MenuQuickAction({ icon, label, onPress, disabled }: { icon: SFSymbol; label: string; onPress: () => void; disabled?: boolean }) {
  const { colors: c } = useTheme();
  const native = useNativeMenuEntry({ kind: 'quick', icon, label, disabled }, onPress);
  if (native) return null;
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} style={[menuStyles.quick, { opacity: disabled ? 0.4 : 1 }]}><SymbolView name={icon} size={24} tintColor={c.text} /><Text style={[menuStyles.quickLabel, { color: c.text }]}>{label}</Text></Pressable>;
}
export function MenuQuickActions({ children }: { children: ReactNode }) { return <MenuGroup><View style={menuStyles.quickRow}>{children}</View></MenuGroup>; }
export function MenuSeparator() {
  const { colors: c } = useTheme();
  const native = useNativeMenuEntry({ kind: 'separator' });
  return native ? null : <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginHorizontal: 22, marginVertical: 8 }} />;
}
export const menuStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: musicChrome.menu.rowHeight, paddingHorizontal: musicChrome.menu.inset, paddingVertical: 14 },
  label: { fontSize: musicChrome.menu.label, lineHeight: musicChrome.menu.lineHeight, fontWeight: '400' },
  subtitle: { fontSize: 14, lineHeight: 19, marginTop: 4 },
  quickRow: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 6, paddingTop: 10, paddingBottom: 10 },
  quick: { flex: 1, alignItems: 'center', minHeight: 76, paddingHorizontal: 3, paddingVertical: 6, gap: 9 },
  quickLabel: { fontSize: 12.5, lineHeight: 16, textAlign: 'center' },
});
