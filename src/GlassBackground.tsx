import { StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useTheme } from './theme';
import { useMotionPreferences } from './motionPreferences';

export default function GlassBackground() {
  const { colors: c, isDark } = useTheme();
  const { reduceTransparency: opaque } = useMotionPreferences();
  if (opaque) return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: c.surface }]} />;
  let native = false;
  try { native = isGlassEffectAPIAvailable() && isLiquidGlassAvailable(); } catch {}
  return native ? <GlassView pointerEvents="none" colorScheme={isDark ? 'dark' : 'light'} glassEffectStyle="regular" style={StyleSheet.absoluteFill} /> : <BlurView pointerEvents="none" tint={isDark ? 'dark' : 'light'} intensity={85} style={[StyleSheet.absoluteFill, { backgroundColor: c.glass }]} />;
}
