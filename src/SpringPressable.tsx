import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  type LayoutChangeEvent,
  type PressableProps,
} from 'react-native';

const Control = Animated.createAnimatedComponent(Pressable);

let pressPoint: { x: number; y: number } | null = null;

export const lastPressPoint = () => pressPoint;

export default function SpringPressable({
  style,
  onPress,
  onPressIn,
  onPressOut,
  onLayout,
  disabled,
  ...props
}: PressableProps) {
  const scaleX = useRef(new Animated.Value(1)).current;
  const scaleY = useRef(new Animated.Value(1)).current;

  const [pressed, setPressed] = useState(false);

  const reduced = useRef(true);
  const size = useRef({ width: 0, height: 0 });
  const animation = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    let alive = true;

    AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (alive) reduced.current = value;
    });

    const sub = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      value => {
        reduced.current = value;

        if (value) {
          animation.current?.stop();
          scaleX.stopAnimation();
          scaleY.stopAnimation();
          scaleX.setValue(1);
          scaleY.setValue(1);
        }
      }
    );

    return () => {
      alive = false;
      sub.remove();
      animation.current?.stop();
      scaleX.stopAnimation();
      scaleY.stopAnimation();
    };
  }, [scaleX, scaleY]);

  function deformation() {
    const width = size.current.width;
    const height = size.current.height;

    if (!width || !height) {
      return { x: 0.94, y: 0.94 };
    }

    const ratio = width / height;

    // Circular / square icon controls.
    if (ratio < 1.35) {
      return {
        x: 0.90,
        y: 0.90,
      };
    }

    // Long Apple-style pills and capsules:
    // slight horizontal contraction, stronger vertical squash.
    if (ratio > 2.15 && height <= 90) {
      return {
        x: 0.978,
        y: 0.885,
      };
    }

    // Rows, cards and medium rectangular controls stay subtler.
    return {
      x: 0.975,
      y: 0.945,
    };
  }

  function stopCurrentAnimation() {
    animation.current?.stop();
    animation.current = null;
    scaleX.stopAnimation();
    scaleY.stopAnimation();
  }

  function pressInAnimation() {
    if (disabled || reduced.current) return;

    stopCurrentAnimation();

    const target = deformation();

    const next = Animated.parallel([
      Animated.timing(scaleX, {
        toValue: target.x,
        duration: 74,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(scaleY, {
        toValue: target.y,
        duration: 74,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]);

    animation.current = next;

    next.start(() => {
      if (animation.current === next) {
        animation.current = null;
      }
    });
  }

  function releaseAnimation() {
    if (disabled || reduced.current) return;

    stopCurrentAnimation();

    /*
     * Different X/Y springs give the same slightly "rubbery" recovery
     * used by the play bubble without making every control feel identical
     * in shape.
     */
    const next = Animated.parallel([
      Animated.spring(scaleX, {
        toValue: 1,
        stiffness: 430,
        damping: 12,
        mass: 0.48,
        overshootClamping: false,
        restDisplacementThreshold: 0.01,
        restSpeedThreshold: 0.01,
        useNativeDriver: true,
      }),
      Animated.spring(scaleY, {
        toValue: 1,
        stiffness: 365,
        damping: 10,
        mass: 0.52,
        overshootClamping: false,
        restDisplacementThreshold: 0.01,
        restSpeedThreshold: 0.01,
        useNativeDriver: true,
      }),
    ]);

    animation.current = next;

    next.start(() => {
      if (animation.current === next) {
        animation.current = null;
      }
    });
  }

  function handleLayout(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;
    size.current = { width, height };
    onLayout?.(event);
  }

  return (
    <Control
      {...props}
      disabled={disabled}
      onLayout={handleLayout}
      onPress={event => {
        const { pageX, pageY } = event.nativeEvent;

        pressPoint =
          Number.isFinite(pageX) && Number.isFinite(pageY)
            ? { x: pageX, y: pageY }
            : null;

        onPress?.(event);
      }}
      style={[
        typeof style === 'function'
          ? style({ pressed })
          : style,
        {
          transform: [
            { scaleX },
            { scaleY },
          ],
        },
      ]}
      onPressIn={event => {
        setPressed(true);
        pressInAnimation();
        onPressIn?.(event);
      }}
      onPressOut={event => {
        setPressed(false);
        releaseAnimation();
        onPressOut?.(event);
      }}
    />
  );
}
