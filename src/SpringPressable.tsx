import { forwardRef, useEffect, useState } from 'react';
import { Pressable, StyleSheet, type View, type PressableProps } from 'react-native';
import Reanimated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useMotionPreferences } from './motionPreferences';

const Control = Reanimated.createAnimatedComponent(Pressable);
const EMPTY_TRANSFORM = [] as const;
let pressPoint: { x: number; y: number } | null = null;
export const lastPressPoint = () => pressPoint;

export default forwardRef<View, PressableProps>(function SpringPressable({ style, onPress, onPressIn, onPressOut, disabled, ...props }, ref) {
  const { reduceMotion } = useMotionPreferences();
  const scale = useSharedValue(1);
  const [pressed, setPressed] = useState(false);
  const base = typeof style === 'function' ? style({ pressed }) : style;
  const transform = StyleSheet.flatten(base)?.transform;
  const originalTransform = Array.isArray(transform) ? transform : EMPTY_TRANSFORM;
  const animated = useAnimatedStyle(() => ({ transform: [...originalTransform, { scale: scale.value }] }));
  useEffect(() => { if (disabled || reduceMotion) scale.value = 1; }, [disabled, reduceMotion, scale]);
  return (
    <Control
      {...props}
      ref={ref}
      disabled={disabled}
      style={[base, animated]}
      onPress={event => {
        const { pageX, pageY } = event.nativeEvent;
        pressPoint = Number.isFinite(pageX) && Number.isFinite(pageY) ? { x: pageX, y: pageY } : null;
        onPress?.(event);
      }}
      onPressIn={event => {
        if (typeof style === 'function') setPressed(true);
        if (!disabled && !reduceMotion) scale.value = withTiming(0.97, { duration: 85 });
        onPressIn?.(event);
      }}
      onPressOut={event => {
        if (typeof style === 'function') setPressed(false);
        scale.value = reduceMotion ? 1 : withSpring(1, { stiffness: 420, damping: 26, mass: 0.6 });
        onPressOut?.(event);
      }}
    />
  );
});
