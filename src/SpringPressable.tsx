import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, type View, type PressableProps } from 'react-native';
import Reanimated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useMotionPreferences } from './motionPreferences';
import { rememberMenuTrigger } from './menuAnchor';
import { musicChrome } from './musicChrome';

const Control = Reanimated.createAnimatedComponent(Pressable);
const EMPTY_TRANSFORM = [] as const;

export default forwardRef<View, PressableProps & { feedback?: 'scale' | 'highlight' }>(function SpringPressable({ style, onPress, onPressIn, onPressOut, disabled, feedback = 'scale', ...props }, ref) {
  const { reduceMotion } = useMotionPreferences();
  const control = useRef<View | null>(null);
  const setRef = useCallback((view: View | null) => {
    control.current = view;
    if (typeof ref === 'function') return ref(view);
    if (ref) ref.current = view;
  }, [ref]);
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
      ref={setRef}
      collapsable={false}
      disabled={disabled}
      style={[base, animated]}
      onPress={event => {
        rememberMenuTrigger(control.current);
        onPress?.(event);
      }}
      onPressIn={event => {
        rememberMenuTrigger(control.current);
        if (typeof style === 'function') setPressed(true);
        if (!disabled && !reduceMotion && feedback === 'scale') scale.value = withTiming(musicChrome.motion.pressScale, { duration: musicChrome.motion.pressDuration });
        onPressIn?.(event);
      }}
      onPressOut={event => {
        if (typeof style === 'function') setPressed(false);
        scale.value = reduceMotion || feedback === 'highlight' ? 1 : withSpring(1, musicChrome.motion.release);
        onPressOut?.(event);
      }}
    />
  );
});
