import { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';

type Props = {
  playing?: boolean;
  color?: string;
  size?: number;
  bars?: number;
};

export default function NowPlayingWaves({
  playing = true,
  color = '#fff',
  size = 16,
  bars = 4,
}: Props) {
  const values = useRef(
    Array.from({ length: bars }, (_, index) =>
      new Animated.Value([0.42, 0.72, 0.55, 0.82][index % 4])
    )
  ).current;

  useEffect(() => {
    const animations = values.map((value, index) => {
      if (!playing) {
        value.stopAnimation();
        value.setValue([0.38, 0.72, 0.52, 0.66][index % 4]);
        return null;
      }

      const low = [0.28, 0.46, 0.34, 0.52][index % 4];
      const high = [0.90, 0.72, 1.00, 0.82][index % 4];
      const up = [210, 260, 190, 235][index % 4];
      const down = [240, 185, 250, 200][index % 4];

      const loop = Animated.loop(
        Animated.sequence([
          Animated.delay(index * 35),
          Animated.timing(value, {
            toValue: high,
            duration: up,
            useNativeDriver: true,
            isInteraction: false,
          }),
          Animated.timing(value, {
            toValue: low,
            duration: down,
            useNativeDriver: true,
            isInteraction: false,
          }),
          Animated.timing(value, {
            toValue: (low + high) / 2,
            duration: 140,
            useNativeDriver: true,
            isInteraction: false,
          }),
        ])
      );

      loop.start();
      return loop;
    });

    return () => {
      for (const animation of animations) {
        animation?.stop();
      }
    };
  }, [playing, values]);

  const barWidth = Math.max(2, Math.round(size * 0.13));
  const gap = Math.max(1.5, size * 0.075);
  const barHeight = size * 0.86;

  return (
    <View
      pointerEvents="none"
      style={{
        width: size,
        height: size,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap,
      }}
    >
      {values.map((value, index) => (
        <Animated.View
          key={index}
          style={{
            width: barWidth,
            height: barHeight,
            borderRadius: barWidth,
            backgroundColor: color,
            transform: [{ scaleY: value }],
          }}
        />
      ))}
    </View>
  );
}
