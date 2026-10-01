import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, { runOnJS, runOnUI, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useMotionPreferences } from './motionPreferences';
import { clampFraction, sliderFraction } from './sliderMath';

type Props = {
  value: number;
  onChange: (value: number) => void;
  onPreview?: (value: number | null) => void;
  live?: boolean;
  enabled?: boolean;
  color: string;
  track: string;
  label: string;
  height?: number;
};

export default memo(function MusicSlider({ value, onChange, onPreview, live = false, enabled = true, color, track, label, height = 5 }: Props) {
  const { reduceMotion } = useMotionPreferences();
  const width = useSharedValue(1);
  const shown = useSharedValue(clampFraction(value));
  const latest = useSharedValue(clampFraction(value));
  const dragging = useSharedValue(false);
  const contact = useSharedValue(0);
  const lastNotification = useSharedValue(0);
  const callbacks = useRef({ onChange, onPreview });
  callbacks.current = { onChange, onPreview };
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const commit = useCallback((next: number) => { if (alive.current) callbacks.current.onChange(next); }, []);
  const preview = useCallback((next: number | null) => { if (alive.current) callbacks.current.onPreview?.(next); }, []);
  useEffect(() => {
    runOnUI((next: number) => {
      latest.value = next;
      if (!dragging.value) shown.value = withTiming(next, { duration: reduceMotion ? 0 : 220 });
    })(clampFraction(value));
  }, [value, reduceMotion, latest, dragging, shown]);
  const gesture = useMemo(() => Gesture.Pan()
    .enabled(enabled)
    .minDistance(0)
    .hitSlop({ top: 8, bottom: 8 })
    .onBegin(event => {
      dragging.value = true;
      contact.value = reduceMotion ? 0 : withTiming(1, { duration: 110 });
      shown.value = sliderFraction(event.x, width.value);
      lastNotification.value = Date.now();
      runOnJS(preview)(shown.value);
      if (live) runOnJS(commit)(shown.value);
    })
    .onUpdate(event => {
      shown.value = sliderFraction(event.x, width.value);
      const now = Date.now();
      if (now - lastNotification.value >= 45) {
        lastNotification.value = now;
        runOnJS(preview)(shown.value);
        if (live) runOnJS(commit)(shown.value);
      }
    })
    .onEnd(event => {
      shown.value = sliderFraction(event.x, width.value);
      runOnJS(commit)(shown.value);
    })
    .onFinalize((_event, success) => {
      dragging.value = false;
      contact.value = reduceMotion ? 0 : withSpring(0, { stiffness: 420, damping: 27, mass: 0.65 });
      if (!success) shown.value = withTiming(latest.value, { duration: 120 });
      runOnJS(preview)(null);
    }), [enabled, reduceMotion, width, shown, latest, dragging, contact, lastNotification, preview, commit, live]);
  const trackStyle = useAnimatedStyle(() => ({ transform: [{ scaleY: 1 + contact.value * 1.5 }] }));
  const fillStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: shown.value }] }));
  return (
    <GestureDetector gesture={gesture}>
      <View
        collapsable={false}
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityState={{ disabled: !enabled }}
        accessibilityValue={{ min: 0, max: 100, now: Math.round(clampFraction(value) * 100) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={event => {
          if (enabled) commit(clampFraction(value + (event.nativeEvent.actionName === 'increment' ? 0.05 : -0.05)));
        }}
        onLayout={event => { width.value = Math.max(1, event.nativeEvent.layout.width); }}
        style={{ height: 28, justifyContent: 'center', opacity: enabled ? 1 : 0.4 }}
      >
        <Reanimated.View pointerEvents="none" style={[{ height, borderRadius: height / 2, overflow: 'hidden', backgroundColor: track }, trackStyle]}>
          <Reanimated.View style={[{ height, backgroundColor: color, transformOrigin: 'left center' }, fillStyle]} />
        </Reanimated.View>
      </View>
    </GestureDetector>
  );
});
