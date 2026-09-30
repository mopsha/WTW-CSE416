import { useEffect, useImperativeHandle, type Ref } from 'react';
import { StyleSheet, Text, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { haptic } from '@/lib/haptics';
import type { Candidate, PreferenceValue } from '@/lib/types';

import { describePlace, PlaceCard } from './PlaceCard';
import { colors, fonts } from './theme';

/** Drag distance that commits an answer. */
const SWIPE_X = 100;
const SWIPE_Y = 100;
/** A fast flick commits even when it's short (like Tinder). */
const FLICK_V = 700;
const FLICK_MIN = 30;
const SNAP_BACK = { damping: 16, stiffness: 190, mass: 0.9 };

export interface SwipeCardHandle {
  /** Animate the card off-screen as if swiped, then report the answer. */
  fling: (value: PreferenceValue) => void;
}

interface Props {
  place: Candidate;
  onAnswer: (value: PreferenceValue) => void;
  /** 0 → 1 as this card is dragged away; drives the next card growing in behind it. */
  drag?: SharedValue<number>;
  /** Opens the details sheet (Tinder-style "more info"). */
  onInfo?: () => void;
  ref?: Ref<SwipeCardHandle>;
}

/**
 * Right = Yes, left = No, up = Maybe. The buttons below fling the card the same way;
 * screen-reader users get the three answers as accessibility actions on the card.
 * Mount with `key={place.placeId}` so every card starts centered.
 */
export function SwipeCard({ place, onAnswer, drag, onInfo, ref }: Props) {
  const { width, height } = useWindowDimensions();
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const armed = useSharedValue(0); // which stamp is past the threshold: 0 none, 1 yes, 2 no, 3 maybe
  const flying = useSharedValue(false); // one answer per card, even on a double tap

  // A fresh top card: the card behind it starts small again.
  useEffect(() => {
    drag?.set(0);
  }, [drag]);

  // Report the answer exactly once: when the fly-out animation ends, or from a backup timer
  // if the animation gets cancelled (e.g. a gesture interrupted by the details sheet).
  const committed = useSharedValue(false);
  const commit = (value: PreferenceValue) => {
    if (committed.get()) return;
    committed.set(true);
    onAnswer(value);
  };
  const armBackup = (value: PreferenceValue, ms: number) => {
    setTimeout(() => commit(value), ms + 150);
  };

  // .set()/.get() instead of .value: the React Compiler treats `.value =` as a mutation.
  const flyOut = (
    answer: PreferenceValue,
    fromX: number,
    fromY: number,
    vx: number,
    vy: number,
  ) => {
    'worklet';
    if (flying.get()) return;
    flying.set(true);
    const speed = Math.hypot(vx, vy);
    const duration = Math.max(160, Math.min(300, 300 - speed / 12));
    const ease = { duration, easing: Easing.out(Easing.cubic) };
    const toX =
      answer === 2 ? width * 1.6 : answer === 0 ? -width * 1.6 : fromX + vx * (duration / 1000);
    const toY = answer === 1 ? -height * 1.1 : fromY + vy * (duration / 1000) * 0.6;
    scheduleOnRN(armBackup, answer, duration);
    drag?.set(withTiming(1, ease));
    tx.set(withTiming(toX, ease));
    ty.set(
      withTiming(toY, ease, () => {
        scheduleOnRN(commit, answer);
      }),
    );
  };

  useImperativeHandle(ref, () => ({
    fling: (value) => {
      if (flying.get()) return;
      haptic.swipe();
      // Buttons get a little "throw" so they feel like a swipe, not a teleport.
      flyOut(value, 0, 0, value === 2 ? 900 : value === 0 ? -900 : 0, value === 1 ? -900 : 60);
    },
  }));

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      if (flying.get()) return;
      tx.set(e.translationX);
      ty.set(e.translationY);
      drag?.set(
        Math.min(1, Math.max(Math.abs(e.translationX) / SWIPE_X, -e.translationY / SWIPE_Y, 0)),
      );
      const horizontal = Math.abs(e.translationX) >= Math.abs(e.translationY);
      const now =
        horizontal && e.translationX > SWIPE_X
          ? 1
          : horizontal && e.translationX < -SWIPE_X
            ? 2
            : !horizontal && e.translationY < -SWIPE_Y
              ? 3
              : 0;
      if (now !== armed.get()) {
        armed.set(now);
        if (now !== 0) scheduleOnRN(haptic.tick);
      }
    })
    .onEnd((e) => {
      if (flying.get()) return;
      const { translationX: x, translationY: y, velocityX: vx, velocityY: vy } = e;
      const horizontal = Math.abs(x) >= Math.abs(y);
      let value: PreferenceValue | null = null;
      if (horizontal && (x > SWIPE_X || (vx > FLICK_V && x > FLICK_MIN))) value = 2;
      else if (horizontal && (x < -SWIPE_X || (vx < -FLICK_V && x < -FLICK_MIN))) value = 0;
      else if (!horizontal && (y < -SWIPE_Y || (vy < -FLICK_V && y < -FLICK_MIN))) value = 1;

      if (value === null) {
        tx.set(withSpring(0, SNAP_BACK));
        ty.set(withSpring(0, SNAP_BACK));
        drag?.set(withSpring(0, SNAP_BACK));
        armed.set(0);
        return;
      }
      scheduleOnRN(haptic.swipe);
      flyOut(value, x, y, vx, vy);
    });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { rotate: `${interpolate(tx.value, [-width, 0, width], [-16, 0, 16])}deg` },
    ],
  }));
  const yesStyle = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [15, SWIPE_X * 0.9], [0, 1], 'clamp'),
    transform: [
      { rotate: '-16deg' },
      { scale: interpolate(tx.value, [15, SWIPE_X], [1.3, 1], 'clamp') },
    ],
  }));
  const noStyle = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [-SWIPE_X * 0.9, -15], [1, 0], 'clamp'),
    transform: [
      { rotate: '16deg' },
      { scale: interpolate(tx.value, [-SWIPE_X, -15], [1, 1.3], 'clamp') },
    ],
  }));
  const maybeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(ty.value, [-SWIPE_Y * 0.9, -15], [1, 0], 'clamp'),
    transform: [{ scale: interpolate(ty.value, [-SWIPE_Y, -15], [1, 1.3], 'clamp') }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[styles.wrap, cardStyle]}
        accessible
        accessibilityLabel={describePlace(place)}
        accessibilityHint="Swipe right for Yes, left for No, up for Maybe. Or use the buttons below."
        accessibilityActions={[
          { name: 'yes', label: 'Yes' },
          { name: 'maybe', label: 'Maybe' },
          { name: 'no', label: 'No' },
        ]}
        onAccessibilityAction={(e) => {
          const v = { yes: 2, maybe: 1, no: 0 }[e.nativeEvent.actionName];
          if (v !== undefined) onAnswer(v as PreferenceValue);
        }}
      >
        <PlaceCard place={place} onInfo={onInfo} />
        <Animated.View style={[styles.stamp, styles.stampYes, yesStyle]} pointerEvents="none">
          <Text style={[styles.stampText, { color: colors.yes }]}>YES</Text>
        </Animated.View>
        <Animated.View style={[styles.stamp, styles.stampNo, noStyle]} pointerEvents="none">
          <Text style={[styles.stampText, { color: colors.no }]}>NOPE</Text>
        </Animated.View>
        <Animated.View style={[styles.stamp, styles.stampMaybe, maybeStyle]} pointerEvents="none">
          <Text style={[styles.stampText, { color: colors.maybe }]}>MAYBE</Text>
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    borderRadius: 28,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },
  stamp: {
    position: 'absolute',
    top: 44,
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderWidth: 4,
    borderRadius: 12,
  },
  stampYes: { left: 26, borderColor: colors.yes },
  stampNo: { right: 26, borderColor: colors.no },
  stampMaybe: { alignSelf: 'center', top: 120, borderColor: colors.maybe },
  stampText: { fontFamily: fonts.black, fontSize: 38, letterSpacing: 3 },
});
