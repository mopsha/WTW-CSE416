import { useImperativeHandle, type Ref } from 'react';
import { StyleSheet, Text, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { haptic } from '@/lib/haptics';
import type { Candidate, PreferenceValue } from '@/lib/types';

import { describePlace, PlaceCard } from './PlaceCard';
import { colors, fonts } from './theme';

const SWIPE_X = 110;
const SWIPE_Y = 100;

export interface SwipeCardHandle {
  /** Animate the card off-screen as if swiped, then report the answer. */
  fling: (value: PreferenceValue) => void;
}

interface Props {
  place: Candidate;
  onAnswer: (value: PreferenceValue) => void;
  ref?: Ref<SwipeCardHandle>;
}

/**
 * Right = Yes, left = No, up = Maybe. The buttons below fling the card the same way;
 * screen-reader users get the three answers as accessibility actions on the card.
 * Mount with `key={place.placeId}` so every card starts centered.
 */
export function SwipeCard({ place, onAnswer, ref }: Props) {
  const { width, height } = useWindowDimensions();
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const armed = useSharedValue(0); // which stamp is past the threshold: 0 none, 1 yes, 2 no, 3 maybe

  const flying = useSharedValue(false); // one answer per card, even on a double tap

  const flyOut = (answer: PreferenceValue, fromX: number, fromY: number) => {
    'worklet';
    if (flying.get()) return;
    flying.set(true);
    // .set()/.get() instead of .value: the React Compiler treats `.value =` as a mutation.
    tx.set(
      withTiming(answer === 2 ? width * 1.5 : answer === 0 ? -width * 1.5 : fromX, {
        duration: 220,
      }),
    );
    ty.set(
      withTiming(answer === 1 ? -height : fromY, { duration: 220 }, (finished) => {
        if (finished) scheduleOnRN(onAnswer, answer);
      }),
    );
  };

  useImperativeHandle(ref, () => ({
    fling: (value) => {
      if (flying.get()) return;
      haptic.swipe();
      flyOut(value, 0, 0);
    },
  }));

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      tx.set(e.translationX);
      ty.set(e.translationY);
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
      const { translationX: x, translationY: y } = e;
      const horizontal = Math.abs(x) >= Math.abs(y);
      let value: PreferenceValue | null = null;
      if (horizontal && x > SWIPE_X) value = 2;
      else if (horizontal && x < -SWIPE_X) value = 0;
      else if (!horizontal && y < -SWIPE_Y) value = 1;

      if (value === null) {
        tx.set(withSpring(0));
        ty.set(withSpring(0));
        return;
      }
      scheduleOnRN(haptic.swipe);
      flyOut(value, x, y);
    });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { rotate: `${interpolate(tx.value, [-width, width], [-14, 14])}deg` },
    ],
  }));
  const yesStyle = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [20, SWIPE_X], [0, 1], 'clamp'),
  }));
  const noStyle = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [-SWIPE_X, -20], [1, 0], 'clamp'),
  }));
  const maybeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(ty.value, [-SWIPE_Y, -20], [1, 0], 'clamp'),
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
        <PlaceCard place={place} />
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
  stampYes: { left: 26, borderColor: colors.yes, transform: [{ rotate: '-16deg' }] },
  stampNo: { right: 26, borderColor: colors.no, transform: [{ rotate: '16deg' }] },
  stampMaybe: { alignSelf: 'center', top: 120, borderColor: colors.maybe },
  stampText: { fontFamily: fonts.black, fontSize: 38, letterSpacing: 3 },
});
