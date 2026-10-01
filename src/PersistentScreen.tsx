import { useEffect, useRef, type ReactNode } from 'react';
import Reanimated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { useMotionPreferences } from './motionPreferences';

export default function PersistentScreen({ active, children }: { active: boolean; children: ReactNode }) {
  const visited = useRef(false);
  if (active) visited.current = true;
  const { reduceMotion } = useMotionPreferences();
  const opacity = useSharedValue(1);
  useEffect(() => {
    if (!active) return;
    opacity.value = reduceMotion ? 1 : 0.94;
    opacity.value = withTiming(1, { duration: reduceMotion ? 0 : 140 });
  }, [active, reduceMotion, opacity]);
  const appearance = useAnimatedStyle(() => ({ opacity: opacity.value }));
  if (!visited.current) return null;
  return (
    <Reanimated.View
      pointerEvents={active ? 'auto' : 'none'}
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}
      style={[{ flex: 1, display: active ? 'flex' : 'none' }, appearance]}
    >{children}</Reanimated.View>
  );
}
