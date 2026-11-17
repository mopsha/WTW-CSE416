// The signed-out intro's looping mini-animations, one per slide: a card swiped Yes, the group's
// answers stacking into a ranking, and the winner popping in. Decorative only (hidden from
// screen readers; each slide's text says the same). Reduce Motion shows a still frame.
import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { useMotionPreference } from '@/hooks/useMotionPreference';

import { colors, fonts } from './theme';

export type IntroSceneName = 'swipe' | 'together' | 'go';

/** 0 → 1 over `ms`, held, then again forever. Reduced motion or offscreen: parked at `rest`. */
function useLoop(ms: number, rest: number, active: boolean): SharedValue<number> {
  const reduced = useMotionPreference();
  const p = useSharedValue(rest);
  useEffect(() => {
    if (reduced || !active) {
      p.set(rest);
      return;
    }
    p.set(
      withRepeat(
        withSequence(
          withTiming(0, { duration: 0 }),
          withDelay(450, withTiming(1, { duration: ms, easing: Easing.out(Easing.cubic) })),
          withDelay(1100, withTiming(1, { duration: 0 })),
        ),
        -1,
      ),
    );
    return () => cancelAnimation(p);
  }, [reduced, active, ms, rest, p]);
  return p;
}

export function IntroScene({
  name,
  size,
  active = true,
}: {
  name: IntroSceneName;
  size: number;
  /** Only the visible slide animates. */
  active?: boolean;
}) {
  return (
    <View
      style={[styles.art, { width: size, height: size, borderRadius: size / 2 }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={`intro-scene-${name}`}
    >
      {name === 'swipe' ? (
        <SwipeScene size={size} active={active} />
      ) : name === 'together' ? (
        <RankScene size={size} active={active} />
      ) : (
        <WinnerScene size={size} active={active} />
      )}
    </View>
  );
}

function MiniCard({ size, icon }: { size: number; icon: keyof typeof Ionicons.glyphMap }) {
  return (
    <View style={[styles.card, { width: size * 0.42, height: size * 0.56 }]}>
      <Ionicons name={icon} size={size * 0.16} color={colors.primary} />
      <View style={[styles.line, { width: '70%' }]} />
      <View style={[styles.line, { width: '45%' }]} />
    </View>
  );
}

function SwipeScene({ size, active }: { size: number; active: boolean }) {
  const p = useLoop(800, 0.35, active);
  const front = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0, 0.75, 1], [1, 1, 0]),
    transform: [
      { translateX: interpolate(p.value, [0, 1], [0, size * 0.55]) },
      { rotate: `${interpolate(p.value, [0, 1], [0, 18])}deg` },
    ],
  }));
  const stamp = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0.05, 0.3], [0, 1], 'clamp'),
  }));
  const back = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(p.value, [0, 1], [0.9, 1]) }],
  }));
  return (
    <>
      <Animated.View style={[styles.layer, back]}>
        <MiniCard size={size} icon="pizza" />
      </Animated.View>
      <Animated.View style={[styles.layer, front]}>
        <MiniCard size={size} icon="restaurant" />
        <Animated.View style={[styles.stamp, stamp]}>
          <Text style={styles.stampText}>YES</Text>
        </Animated.View>
      </Animated.View>
    </>
  );
}

const ROWS = [
  { width: 92, color: colors.yes },
  { width: 64, color: colors.maybe },
  { width: 38, color: colors.no },
];

function RankRow({ p, i }: { p: SharedValue<number>; i: number }) {
  const row = ROWS[i]!;
  const bar = useAnimatedStyle(() => ({
    width: `${interpolate(p.value, [i * 0.15, 0.55 + i * 0.15], [8, row.width], 'clamp')}%`,
  }));
  return (
    <View style={styles.rankRow}>
      <Text style={styles.rank}>{i + 1}</Text>
      <View style={styles.track}>
        <Animated.View style={[styles.bar, { backgroundColor: row.color }, bar]} />
      </View>
    </View>
  );
}

function RankScene({ size, active }: { size: number; active: boolean }) {
  const p = useLoop(1100, 1, active);
  return (
    <View style={{ width: size * 0.6, gap: size * 0.05 }}>
      <View style={styles.avatars}>
        {[colors.primary, colors.maybe, colors.yes].map((c) => (
          <View key={c} style={[styles.avatar, { backgroundColor: c }]} />
        ))}
      </View>
      {ROWS.map((row, i) => (
        <RankRow key={row.color} p={p} i={i} />
      ))}
    </View>
  );
}

const CONFETTI = [0, 60, 120, 180, 240, 300];
const CONFETTI_COLORS = [colors.yes, colors.maybe, colors.primary];

function Confetti({ p, angle, size }: { p: SharedValue<number>; angle: number; size: number }) {
  const dx = Math.cos((angle * Math.PI) / 180);
  const dy = Math.sin((angle * Math.PI) / 180);
  const style = useAnimatedStyle(() => {
    const d = interpolate(p.value, [0.2, 1], [0, size * 0.36], 'clamp');
    return {
      opacity: interpolate(p.value, [0.2, 0.4, 1], [0, 1, 0], 'clamp'),
      transform: [{ translateX: dx * d }, { translateY: dy * d }],
    };
  });
  const color = CONFETTI_COLORS[(angle / 60) % CONFETTI_COLORS.length];
  return <Animated.View style={[styles.confetti, { backgroundColor: color }, style]} />;
}

function WinnerScene({ size, active }: { size: number; active: boolean }) {
  const p = useLoop(900, 1, active);
  const pop = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0, 0.2], [0, 1], 'clamp'),
    transform: [{ scale: interpolate(p.value, [0, 0.35, 0.55, 1], [0.4, 1.12, 1, 1], 'clamp') }],
  }));
  return (
    <>
      {CONFETTI.map((a) => (
        <Confetti key={a} p={p} angle={a} size={size} />
      ))}
      <Animated.View style={pop}>
        <Ionicons name="trophy" size={size * 0.36} color={colors.primary} />
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  art: {
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  layer: { position: 'absolute' },
  card: {
    backgroundColor: colors.bg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  line: { height: 6, borderRadius: 3, backgroundColor: colors.border },
  stamp: {
    position: 'absolute',
    top: 10,
    left: 8,
    borderWidth: 2,
    borderColor: colors.yes,
    borderRadius: 6,
    paddingHorizontal: 5,
    transform: [{ rotate: '-14deg' }],
  },
  stampText: { fontFamily: fonts.black, fontSize: 14, color: colors.yes, letterSpacing: 1 },
  avatars: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginBottom: 4 },
  avatar: { width: 18, height: 18, borderRadius: 9 },
  rankRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rank: { fontFamily: fonts.bold, fontSize: 13, color: colors.muted, width: 12 },
  track: { flex: 1, height: 12, borderRadius: 6, backgroundColor: colors.bg },
  bar: { height: 12, borderRadius: 6 },
  confetti: { position: 'absolute', width: 10, height: 10, borderRadius: 3 },
});
