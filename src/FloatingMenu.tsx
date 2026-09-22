import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Modal, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import GlassBackground from './GlassBackground';
import { useTheme } from './theme';
import { lastPressPoint } from './SpringPressable';

export default function FloatingMenu({ children, onClose, busy = false }: { children: ReactNode; onClose: () => void; busy?: boolean }) {
  const { colors: c } = useTheme();
  const { width, height } = useWindowDimensions();
  const [anchor] = useState(lastPressPoint);
  const scale = useRef(new Animated.Value(1)).current;
  const shift = useRef(new Animated.Value(0)).current;
  const reduced = useRef(true);
  const closing = useRef(false);
  const maxHeight = Math.min(height * .61, height - 120);
  const menuWidth = Math.min(280, width * .64);
  const top = Math.max(60, Math.min(anchor?.y ?? 110, height - maxHeight - 40));
  const left = Math.max(16, Math.min((anchor?.x ?? width - 20) - menuWidth + 16, width - menuWidth - 16));
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then(v => {
      if (!active) return; reduced.current = v;
      if (!v) { scale.setValue(.88); shift.setValue(-8); Animated.parallel([Animated.spring(scale, { toValue: 1, damping: 24, stiffness: 340, useNativeDriver: true }), Animated.spring(shift, { toValue: 0, damping: 24, stiffness: 340, useNativeDriver: true })]).start(); }
    });
    return () => { active = false; scale.stopAnimation(); shift.stopAnimation(); };
  }, []);
  function close() {
    if (busy || closing.current) return;
    closing.current = true;
    if (reduced.current) { onClose(); return; }
    Animated.parallel([Animated.timing(scale, { toValue: .88, duration: 140, useNativeDriver: true }), Animated.timing(shift, { toValue: -8, duration: 140, useNativeDriver: true })]).start(({ finished }) => { if (finished) onClose(); });
  }
  return <Modal transparent animationType="none" statusBarTranslucent onRequestClose={close}>
    <View style={{ flex: 1 }} accessibilityViewIsModal>
      <Pressable disabled={busy} accessibilityLabel="Chiudi menu" onPress={close} style={{ position: 'absolute', inset: 0, backgroundColor: '#00000012' }} />
      <Animated.View style={{ position: 'absolute', top, left, width: menuWidth, maxHeight, borderRadius: 25, shadowColor: '#000', shadowOpacity: .2, shadowRadius: 28, shadowOffset: { width: 0, height: 10 }, transformOrigin: 'top right', transform: [{ translateY: shift }, { scale }] }}>
        <View style={{ maxHeight, borderRadius: 25, overflow: 'hidden', borderWidth: .5, borderColor: c.border }}><GlassBackground /><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 12 }}>{children}</ScrollView></View>
      </Animated.View>
    </View>
  </Modal>;
}
