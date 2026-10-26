import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Keyboard, Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import GlassBackground from './GlassBackground';
import { useTheme } from './theme';
import { measureMenuAnchor, type MenuAnchor } from './menuAnchor';
import { useMotionPreferences } from './motionPreferences';
import { useScreenInsets } from './ScreenInsets';
import { menuLayout } from './menuLayout';

export default function FloatingMenu({ children, onClose, busy = false }: { children: ReactNode; onClose: () => void; busy?: boolean }) {
  const { isDark } = useTheme();
  const { width, height, fontScale } = useWindowDimensions();
  const insets = useScreenInsets();
  const { reduceMotion, reduceTransparency } = useMotionPreferences();
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const [anchorReady, setAnchorReady] = useState(false);
  const [contentHeight, setContentHeight] = useState(0);
  const progress = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const scroll = useRef<ScrollView>(null);
  const closing = useRef(false);
  const layout = menuLayout(width, height, insets.top, insets.bottom, anchor, contentHeight, fontScale);
  const ready = anchorReady && contentHeight > 0;
  useEffect(() => {
    Keyboard.dismiss();
    return measureMenuAnchor(point => { setAnchor(point); setAnchorReady(true); });
  }, []);
  useEffect(() => {
    if (!ready) return;
    const animation = Animated.spring(progress, { toValue: 1, damping: 26, stiffness: 340, useNativeDriver: true });
    if (reduceMotion) progress.setValue(1); else animation.start();
    return () => animation.stop();
  }, [progress, reduceMotion, ready]);
  useEffect(() => {
    if (!ready || contentHeight <= layout.maxHeight) return;
    const timer = setTimeout(() => scroll.current?.flashScrollIndicators(), 300);
    return () => clearTimeout(timer);
  }, [ready, contentHeight, layout.maxHeight]);
  function close() {
    if (busy || closing.current) return;
    closing.current = true;
    if (reduceMotion || !ready) { onClose(); return; }
    Animated.timing(progress, { toValue: 0, duration: 140, useNativeDriver: true }).start(({ finished }) => { if (finished) onClose(); });
  }
  return <Modal transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={close}>
    <View style={{ flex: 1 }} accessibilityViewIsModal onAccessibilityEscape={close}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? '#00000024' : '#0000000a', opacity: progress }]} />
      <Pressable disabled={busy} accessibilityRole="button" accessibilityLabel="Chiudi menu" onPress={close} style={StyleSheet.absoluteFill} />
      {/* Never fade a GlassView ancestor to zero: iOS can stop rendering its material.
          Measure offscreen first so the panel does not jump after its first layout. */}
      <Animated.View pointerEvents={ready ? 'auto' : 'none'} accessibilityElementsHidden={!ready} importantForAccessibility={ready ? 'auto' : 'no-hide-descendants'} style={{ position: 'absolute', ...layout, left: ready ? layout.left : width + 24, borderRadius: 32, shadowColor: '#000', shadowOpacity: isDark ? .3 : .16, shadowRadius: 26, shadowOffset: { width: 0, height: 10 }, transformOrigin: 'top right', transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [.94, 1] }) }] }}>
        <View style={{ maxHeight: layout.maxHeight, borderRadius: 32, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: isDark ? '#ffffff30' : '#00000020' }}>
          <GlassBackground />
          {/* Stable contrast even if native blur is unavailable; other app chrome stays unchanged. */}
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? (reduceTransparency ? '#29292c' : 'rgba(41,41,44,0.94)') : (reduceTransparency ? '#fafafa' : 'rgba(250,250,250,0.96)') }]} />
          <ScrollView ref={scroll} style={{ flexGrow: 0, maxHeight: layout.maxHeight - 2 }} bounces={false} showsVerticalScrollIndicator indicatorStyle={isDark ? 'white' : 'black'} scrollIndicatorInsets={{ top: 28, bottom: 28, right: 3 }} keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="never" onContentSizeChange={(_, h) => setContentHeight(h + 2)} contentContainerStyle={{ paddingVertical: 12 }}>
            {children}
          </ScrollView>
        </View>
      </Animated.View>
    </View>
  </Modal>;
}
