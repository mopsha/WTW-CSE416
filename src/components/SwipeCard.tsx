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

import type { Candidate, PreferenceValue } from '@/lib/types';

import { describePlace, PlaceCard } from './PlaceCard';
import { colors } from './theme';

const SWIPE_X = 110;
const SWIPE_Y = 100;

interface Props {
  place: Candidate;
  onAnswer: (value: PreferenceValue) => void;
}

/**
 * Right = Yes, left = No, up = Maybe. The buttons below the card do the same thing;
 * screen-reader users get the three answers as accessibility actions on the card.
 * Mount with `key={place.placeId}` so every card starts centered.
 */
export function SwipeCard({ place, onAnswer }: Props) {
  const { width, height } = useWindowDimensions();
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      tx.value = e.translationX;
      ty.value = e.translationY;
    })
    .onEnd((e) => {
      const { translationX: x, translationY: y } = e;
      const horizontal = Math.abs(x) >= Math.abs(y);
      let value: PreferenceValue | null = null;
      if (horizontal && x > SWIPE_X) value = 2;
      else if (horizontal && x < -SWIPE_X) value = 0;
      else if (!horizontal && y < -SWIPE_Y) value = 1;

      if (value === null) {
        tx.value = withSpring(0);
        ty.value = withSpring(0);
        return;
      }
      const answer = value;
      tx.value = withTiming(answer === 2 ? width * 1.5 : answer === 0 ? -width * 1.5 : x, {
        duration: 180,
      });
      ty.value = withTiming(answer === 1 ? -height : y, { duration: 180 }, (finished) => {
        if (finished) scheduleOnRN(onAnswer, answer);
      });
    });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { rotate: `${interpolate(tx.value, [-width, width], [-12, 12])}deg` },
    ],
  }));
  const yesStyle = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [0, SWIPE_X], [0, 1], 'clamp'),
  }));
  const noStyle = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [-SWIPE_X, 0], [1, 0], 'clamp'),
  }));
  const maybeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(ty.value, [-SWIPE_Y, 0], [1, 0], 'clamp'),
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
          <Text style={[styles.stampText, { color: colors.no }]}>NO</Text>
        </Animated.View>
        <Animated.View style={[styles.stamp, styles.stampMaybe, maybeStyle]} pointerEvents="none">
          <Text style={[styles.stampText, { color: colors.maybe }]}>MAYBE</Text>
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  stamp: {
    position: 'absolute',
    top: 20,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderWidth: 3,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.85)',
  },
  stampYes: { left: 20, borderColor: colors.yes, transform: [{ rotate: '-12deg' }] },
  stampNo: { right: 20, borderColor: colors.no, transform: [{ rotate: '12deg' }] },
  stampMaybe: { alignSelf: 'center', borderColor: colors.maybe },
  stampText: { fontSize: 28, fontWeight: '800', letterSpacing: 2 },
});
