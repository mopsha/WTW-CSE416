import { useEffect, useMemo } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

const COLORS = ['#FF3D71', '#FF7A45', '#FFD23F', '#2BD98B', '#4DA3FF', '#B57BFF'];

function Piece({ i, width, height }: { i: number; width: number; height: number }) {
  const seed = useMemo(() => {
    const r = (n: number) => ((Math.sin(i * 999 + n * 77) + 1) / 2) % 1;
    return {
      x: r(1) * width,
      drift: (r(2) - 0.5) * 160,
      delay: r(3) * 500,
      duration: 2200 + r(4) * 1400,
      spin: (r(5) - 0.5) * 1080,
      w: 6 + r(6) * 8,
      color: COLORS[i % COLORS.length] ?? '#FF3D71',
    };
  }, [i, width]);
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withDelay(
      seed.delay,
      withTiming(1, { duration: seed.duration, easing: Easing.out(Easing.quad) }),
    );
  }, [p, seed]);
  const style = useAnimatedStyle(() => ({
    opacity: p.value < 0.85 ? 1 : (1 - p.value) / 0.15,
    transform: [
      { translateX: seed.x + seed.drift * p.value },
      { translateY: -40 + (height + 80) * p.value },
      { rotate: `${seed.spin * p.value}deg` },
    ],
  }));
  return (
    <Animated.View
      style={[
        styles.piece,
        { width: seed.w, height: seed.w * 0.45, backgroundColor: seed.color },
        style,
      ]}
    />
  );
}

/** A one-shot confetti burst over the whole screen. */
export function Confetti({ count = 60 }: { count?: number }) {
  const { width, height } = useWindowDimensions();
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {Array.from({ length: count }, (_, i) => (
        <Piece key={i} i={i} width={width} height={height} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  piece: { position: 'absolute', left: 0, top: 0, borderRadius: 2 },
});
