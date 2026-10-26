import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useWindowDimensions, Keyboard, ScrollView, StyleSheet, Text, TextInput, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import Pressable from './SpringPressable';
import GlassBackground from './GlassBackground';
import { useTheme } from './theme';
import { useMotionPreferences } from './motionPreferences';
import { SEARCH_TRANSITION_MS, searchTitleHeight } from './searchMotion';
import { searchHeaderMetrics } from './responsiveLayout';

type Props = {
  query: string; scope: 'qobuz' | 'library'; searching: boolean; resetKey: number;
  input: RefObject<TextInput | null>; browse: ReactNode; children: ReactNode;
  onChange: (query: string) => void; onScope: (scope: 'qobuz' | 'library') => void;
  onFocus: () => void; onBlur: () => void; onSubmit: () => void; onClose: () => void;
  onSettings: () => void; onDictation: () => void;
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
};

export default function SearchScaffold(p: Props) {
  const { colors: c, isDark } = useTheme();
  const { reduceMotion } = useMotionPreferences();
  const { fontScale } = useWindowDimensions();
  const { titleHeight, fieldHeight, scopeHeight, pinnedHeight } = searchHeaderMetrics(fontScale);
  const browseScroll = useRef<ScrollView>(null), resultScroll = useRef<ScrollView>(null);
  const offset = useSharedValue(0), editing = useSharedValue(p.searching ? 1 : 0);
  const selection = useSharedValue(p.scope === 'library' ? 1 : 0);
  const [scopeWidth, setScopeWidth] = useState(0);
  const duration = reduceMotion ? 0 : SEARCH_TRANSITION_MS;
  useEffect(() => {
    editing.value = withTiming(p.searching ? 1 : 0, { duration, easing: Easing.out(Easing.cubic) });
  }, [p.searching, duration, editing]);
  useEffect(() => {
    selection.value = withTiming(p.scope === 'library' ? 1 : 0, { duration: reduceMotion ? 0 : 220 });
  }, [p.scope, reduceMotion, selection]);
  useEffect(() => {
    browseScroll.current?.scrollTo({ y: 0, animated: false });
    offset.value = 0;
  }, [p.resetKey, p.scope, offset]);
  useEffect(() => { resultScroll.current?.scrollTo({ y: 0, animated: false }); }, [p.query, p.scope, p.searching]);
  const forwardScroll = (event: NativeScrollEvent) => p.onScroll({ nativeEvent: event } as NativeSyntheticEvent<NativeScrollEvent>);
  const scrollHandler = useAnimatedScrollHandler(event => {
    offset.value = event.contentOffset.y;
    runOnJS(forwardScroll)(event);
  });
  const titleStyle = useAnimatedStyle(() => ({
    height: searchTitleHeight(offset.value, editing.value, titleHeight),
    opacity: Math.max(0, 1 - Math.max(0, offset.value) / titleHeight) * (1 - editing.value),
  }));
  const cancelStyle = useAnimatedStyle(() => ({
    width: (fieldHeight + 10) * editing.value, opacity: editing.value,
    transform: [{ scale: 0.85 + 0.15 * editing.value }],
  }));
  const browseStyle = useAnimatedStyle(() => ({
    opacity: 1 - editing.value,
    transform: [{ translateY: reduceMotion ? 0 : -12 * editing.value }],
  }));
  const resultsStyle = useAnimatedStyle(() => ({ opacity: editing.value }));
  const spacerStyle = useAnimatedStyle(() => ({ height: pinnedHeight + searchTitleHeight(offset.value, editing.value, titleHeight) }));
  const selectionStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: selection.value * Math.max(0, (scopeWidth - 6) / 2) }],
  }));
  return <View style={{ flex: 1, overflow: 'hidden', backgroundColor: c.background }}>
    <Animated.View style={[StyleSheet.absoluteFill, browseStyle]} pointerEvents={p.searching ? 'none' : 'auto'} accessibilityElementsHidden={p.searching} importantForAccessibility={p.searching ? 'no-hide-descendants' : 'auto'}>
      <Animated.ScrollView ref={browseScroll} onScroll={scrollHandler} scrollEventThrottle={16}
        contentInsetAdjustmentBehavior="never" contentContainerStyle={{ paddingHorizontal: 18, paddingTop: titleHeight + pinnedHeight, paddingBottom: 200 }}>
        {p.browse}
      </Animated.ScrollView>
    </Animated.View>
    <Animated.View style={[StyleSheet.absoluteFill, resultsStyle]} pointerEvents={p.searching ? 'auto' : 'none'} accessibilityElementsHidden={!p.searching} importantForAccessibility={p.searching ? 'auto' : 'no-hide-descendants'}>
      <ScrollView ref={resultScroll} onScroll={p.onScroll} scrollEventThrottle={32} keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets contentInsetAdjustmentBehavior="never"
        contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 200 }}>
        <Animated.View style={spacerStyle} />
        {p.children}
      </ScrollView>
    </Animated.View>
    <View style={styles.header} pointerEvents="box-none">
      <Animated.View style={[styles.title, { backgroundColor: c.background }, titleStyle]} pointerEvents={p.searching ? 'none' : 'auto'} accessibilityElementsHidden={p.searching}>
        <Text maxFontSizeMultiplier={1.4} style={{ color: c.text, fontSize: 34, fontWeight: '700', letterSpacing: -0.8, flex: 1 }}>Cerca</Text>
        <Pressable onPress={p.onSettings} accessibilityRole="button" accessibilityLabel="Apri impostazioni" style={styles.profile}>
          <Ionicons name="person-circle-outline" size={36} color={c.secondary} />
        </Pressable>
      </Animated.View>
      <View style={{ paddingHorizontal: 18, paddingTop: 8, paddingBottom: 10 }}>
        <View style={[styles.searchRow, { height: fieldHeight }]}>
          <View style={[styles.field, { borderColor: c.border, height: fieldHeight, borderRadius: fieldHeight / 2 }]}>
            <GlassBackground />
            <Ionicons name="search" size={21} color={c.text} />
            <TextInput ref={p.input} value={p.query} onChangeText={p.onChange} onFocus={p.onFocus} onBlur={p.onBlur}
              onSubmitEditing={() => { p.onSubmit(); Keyboard.dismiss(); }}
              placeholder={p.scope === 'library' ? 'La tua libreria' : 'Artisti, brani e album'}
              placeholderTextColor={c.secondary} selectionColor={c.accent}
              style={{ flex: 1, minWidth: 0, paddingHorizontal: 8, paddingVertical: 10, color: c.text, fontSize: 17 }}
              maxFontSizeMultiplier={1.4} maxLength={200} returnKeyType="search" autoCorrect={false} autoCapitalize="none" accessibilityLabel="Cerca musica" />
            <Pressable onPress={() => { if (p.query) p.onChange(''); else p.onDictation(); p.input.current?.focus(); }}
              accessibilityLabel={p.query ? 'Cancella testo' : 'Dettatura con la tastiera'} style={[styles.inputAction, { height: fieldHeight }]}>
              <Ionicons name={p.query ? 'close-circle' : 'mic-outline'} size={p.query ? 20 : 22} color={c.text} />
            </Pressable>
          </View>
          <Animated.View style={[styles.cancelSlot, { height: fieldHeight }, cancelStyle]} pointerEvents={p.searching ? 'auto' : 'none'} accessibilityElementsHidden={!p.searching}>
            <Pressable onPress={p.onClose} accessibilityRole="button" accessibilityLabel="Chiudi e cancella ricerca" style={[styles.cancel, { borderColor: c.border, width: fieldHeight, height: fieldHeight, borderRadius: fieldHeight / 2 }]}>
              <GlassBackground /><Ionicons name="close" size={29} color={c.text} />
            </Pressable>
          </Animated.View>
        </View>
        <View onLayout={e => setScopeWidth(e.nativeEvent.layout.width)} style={[styles.scopes, { borderColor: c.border, height: scopeHeight, borderRadius: scopeHeight / 2 }]}>
          <GlassBackground />
          <Animated.View pointerEvents="none" style={[styles.selection, { width: Math.max(0, (scopeWidth - 6) / 2), backgroundColor: isDark ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.8)' }, selectionStyle]} />
          {(['qobuz', 'library'] as const).map(scope => <Pressable key={scope} onPress={() => p.onScope(scope)}
            accessibilityRole="tab" accessibilityState={{ selected: p.scope === scope }} style={styles.scope}>
            <Text maxFontSizeMultiplier={1.3} style={{ color: c.text, fontSize: 15, fontWeight: '500' }}>{scope === 'qobuz' ? 'Qobuz' : 'Libreria'}</Text>
          </Pressable>)}
        </View>
      </View>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  header: { position: 'absolute', top: 0, left: 0, right: 0 },
  title: { flexDirection: 'row', alignItems: 'center', overflow: 'hidden', paddingHorizontal: 18 },
  profile: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
  searchRow: { flexDirection: 'row', alignItems: 'center', height: 46 },
  field: { flex: 1, flexDirection: 'row', alignItems: 'center', height: 46, borderRadius: 23, borderWidth: 0.5, overflow: 'hidden', paddingLeft: 13 },
  inputAction: { width: 42, height: 46, alignItems: 'center', justifyContent: 'center' },
  cancelSlot: { overflow: 'hidden', height: 46 },
  cancel: { marginLeft: 10, width: 46, height: 46, borderRadius: 23, borderWidth: 0.5, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  scopes: { flexDirection: 'row', height: 34, borderRadius: 17, borderWidth: 0.5, overflow: 'hidden', marginTop: 10, padding: 3 },
  selection: { position: 'absolute', top: 3, left: 3, bottom: 3, borderRadius: 14 },
  scope: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
