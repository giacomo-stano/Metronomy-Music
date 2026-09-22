import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Keyboard, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

export function useMiniMotion(route: string, distance: number) {
  const slide = useRef(new Animated.Value(0)).current;
  const [hidden, setHidden] = useState(false);
  const [reduce, setReduce] = useState(true);
  const [reader, setReader] = useState(false);
  const lastY = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyboard = useRef(false);
  const clear = useCallback(() => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then(v => { if (active) setReduce(v); }).catch(() => {});
    AccessibilityInfo.isScreenReaderEnabled().then(v => { if (active) setReader(v); }).catch(() => {});
    const a = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    const b = AccessibilityInfo.addEventListener('screenReaderChanged', setReader);
    const k = Keyboard.addListener('keyboardDidShow', () => { keyboard.current = true; clear(); setHidden(true); });
    const l = Keyboard.addListener('keyboardDidHide', () => { keyboard.current = false; setHidden(false); });
    return () => { active = false; a.remove(); b.remove(); k.remove(); l.remove(); clear(); };
  }, [clear]);
  useEffect(() => { clear(); lastY.current = 0; if (!keyboard.current) setHidden(false); }, [route, reduce, reader, clear]);
  useEffect(() => { const animation = Animated.timing(slide, { toValue: hidden ? distance : 0, duration: reduce ? 0 : 260, useNativeDriver: true }); animation.start(); return () => animation.stop(); }, [hidden, distance, reduce, slide]);
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = Math.max(0, event.nativeEvent.contentOffset.y); const delta = y - lastY.current; lastY.current = y;
    if (reduce || reader || keyboard.current) return;
    if (y < 20 || delta < -3) setHidden(false);
    else if (delta > 3) setHidden(true);
    clear(); timer.current = setTimeout(() => { if (!keyboard.current) setHidden(false); }, 800);
  }, [reduce, reader, clear]);
  return { slide, hidden, onScroll };
}
