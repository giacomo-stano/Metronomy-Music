import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Keyboard, Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import GlassBackground from './GlassBackground';
import { useTheme } from './theme';
import { lastPressPoint } from './SpringPressable';
import { useMotionPreferences } from './motionPreferences';
import { useScreenInsets } from './ScreenInsets';
import { menuLayout } from './menuLayout';

export default function FloatingMenu({ children, onClose, busy = false }: { children: ReactNode; onClose: () => void; busy?: boolean }) {
  const { colors: c, isDark } = useTheme();
  const { width, height } = useWindowDimensions();
  const insets = useScreenInsets();
  const { reduceMotion } = useMotionPreferences();
  const [anchor] = useState(lastPressPoint);
  const [contentHeight, setContentHeight] = useState(0);
  const progress = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const scroll = useRef<ScrollView>(null);
  const closing = useRef(false);
  const layout = menuLayout(width, height, insets.top, insets.bottom, anchor, contentHeight);
  useEffect(() => {
    Keyboard.dismiss();
    const animation = Animated.spring(progress, { toValue: 1, damping: 26, stiffness: 340, useNativeDriver: true });
    if (reduceMotion) progress.setValue(1); else animation.start();
    return () => animation.stop();
  }, [progress, reduceMotion]);
  function close() {
    if (busy || closing.current) return;
    closing.current = true;
    if (reduceMotion) { onClose(); return; }
    Animated.timing(progress, { toValue: 0, duration: 140, useNativeDriver: true }).start(({ finished }) => { if (finished) onClose(); });
  }
  return <Modal transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={close}>
    <View style={{ flex: 1 }} accessibilityViewIsModal onAccessibilityEscape={close}>
      <Pressable disabled={busy} accessibilityRole="button" accessibilityLabel="Chiudi menu" onPress={close} style={[StyleSheet.absoluteFill, { backgroundColor: '#0000000a' }]} />
      <Animated.View style={{ position: 'absolute', ...layout, borderRadius: 32, shadowColor: '#000', shadowOpacity: .18, shadowRadius: 26, shadowOffset: { width: 0, height: 10 }, opacity: progress, transformOrigin: 'top right', transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [.9, 1] }) }] }}>
        <View style={{ maxHeight: layout.maxHeight, borderRadius: 32, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: c.border }}>
          <GlassBackground />
          <ScrollView ref={scroll} bounces={false} showsVerticalScrollIndicator indicatorStyle={isDark ? 'white' : 'black'} keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="never" onContentSizeChange={(_, h) => { setContentHeight(h); if (h > layout.maxHeight) scroll.current?.flashScrollIndicators(); }} contentContainerStyle={{ paddingVertical: 12 }}>
            {children}
          </ScrollView>
        </View>
      </Animated.View>
    </View>
  </Modal>;
}
