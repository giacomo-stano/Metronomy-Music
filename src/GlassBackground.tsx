import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useTheme } from './theme';

export default function GlassBackground() {
  const { colors: c, isDark } = useTheme();
  const [opaque, setOpaque] = useState(true);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceTransparencyEnabled().then(v => { if (active) setOpaque(v); }).catch(() => {});
    const event = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setOpaque);
    return () => { active = false; event.remove(); };
  }, []);
  if (opaque) return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: c.surface }]} />;
  let native = false;
  try { native = isGlassEffectAPIAvailable() && isLiquidGlassAvailable(); } catch {}
  return native ? <GlassView pointerEvents="none" colorScheme={isDark ? 'dark' : 'light'} glassEffectStyle="regular" style={StyleSheet.absoluteFill} /> : <BlurView pointerEvents="none" tint={isDark ? 'dark' : 'light'} intensity={85} style={[StyleSheet.absoluteFill, { backgroundColor: c.glass }]} />;
}
