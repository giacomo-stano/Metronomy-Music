import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  type PressableProps,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SymbolView } from 'expo-symbols';

import Pressable from './SpringPressable';

type Props = {
  playing: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  style?: PressableProps['style'];
  color: string;
  size: number;
  variant?: 'ionicons' | 'symbol';
};

export default function ElasticPlayPauseButton({
  playing,
  onPress,
  accessibilityLabel,
  style,
  color,
  size,
  variant = 'symbol',
}: Props) {
  const [displayPlaying, setDisplayPlaying] = useState(playing);

  const scaleX = useRef(new Animated.Value(1)).current;
  const scaleY = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  const playingRef = useRef(playing);
  const animationToken = useRef(0);
  const reducedMotion = useRef(false);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    playingRef.current = playing;

    if (displayPlaying !== playing) {
      animateTo(playing, false);
    }
    // animateTo intentionally stays stable through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  useEffect(() => {
    let alive = true;

    AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (alive) reducedMotion.current = value;
    });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      value => {
        reducedMotion.current = value;

        if (value) {
          animationToken.current++;
          scaleX.stopAnimation();
          scaleY.stopAnimation();
          opacity.stopAnimation();
          scaleX.setValue(1);
          scaleY.setValue(1);
          opacity.setValue(1);
          setDisplayPlaying(playingRef.current);
        }
      }
    );

    return () => {
      alive = false;
      subscription.remove();

      if (syncTimer.current) {
        clearTimeout(syncTimer.current);
        syncTimer.current = null;
      }

      scaleX.stopAnimation();
      scaleY.stopAnimation();
      opacity.stopAnimation();
    };
  }, [opacity, scaleX, scaleY]);

  function animateTo(targetPlaying: boolean, immediateFromPress: boolean) {
    const token = ++animationToken.current;

    if (syncTimer.current) {
      clearTimeout(syncTimer.current);
      syncTimer.current = null;
    }

    scaleX.stopAnimation();
    scaleY.stopAnimation();
    opacity.stopAnimation();

    if (reducedMotion.current) {
      scaleX.setValue(1);
      scaleY.setValue(1);
      opacity.setValue(1);
      setDisplayPlaying(targetPlaying);
      return;
    }

    /*
     * Reference-video motion:
     * 1. the current glyph collapses almost into a dot;
     * 2. it is swapped at the smallest point;
     * 3. the new glyph grows past its final size and springs back.
     *
     * scaleX collapses more than scaleY to create the elastic/squashed feel.
     */
    Animated.parallel([
      Animated.timing(scaleX, {
        toValue: 0.10,
        duration: immediateFromPress ? 82 : 74,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(scaleY, {
        toValue: 0.42,
        duration: immediateFromPress ? 82 : 74,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0.72,
        duration: immediateFromPress ? 82 : 74,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (!finished || token !== animationToken.current) return;

      setDisplayPlaying(targetPlaying);

      // Start the new symbol from a compressed shape.
      scaleX.setValue(0.16);
      scaleY.setValue(0.48);
      opacity.setValue(0.82);

      Animated.parallel([
        Animated.spring(scaleX, {
          toValue: 1,
          stiffness: 520,
          damping: 13,
          mass: 0.46,
          overshootClamping: false,
          restDisplacementThreshold: 0.001,
          restSpeedThreshold: 0.001,
          useNativeDriver: true,
        }),
        Animated.spring(scaleY, {
          toValue: 1,
          stiffness: 420,
          damping: 14,
          mass: 0.50,
          overshootClamping: false,
          restDisplacementThreshold: 0.001,
          restSpeedThreshold: 0.001,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 115,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start();

      /*
       * If audio playback failed to change state, sync the glyph back to the
       * real player status after the visual response has finished.
       */
      syncTimer.current = setTimeout(() => {
        syncTimer.current = null;

        if (
          token === animationToken.current &&
          playingRef.current !== targetPlaying
        ) {
          animateTo(playingRef.current, false);
        }
      }, 430);
    });
  }

  function handlePress() {
    animateTo(!playingRef.current, true);
    onPress();
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={style}
      onPress={handlePress}
    >
      <Animated.View
        pointerEvents="none"
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          opacity,
          transform: [{ scaleX }, { scaleY }],
        }}
      >
        {variant === 'ionicons' ? (
          <Ionicons
            name={displayPlaying ? 'pause' : 'play'}
            color={color}
            size={size}
          />
        ) : (
          <SymbolView
            name={displayPlaying ? 'pause.fill' : 'play.fill'}
            size={size}
            weight="regular"
            tintColor={color}
          />
        )}
      </Animated.View>
    </Pressable>
  );
}
