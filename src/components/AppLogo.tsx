import { Ionicons } from '@expo/vector-icons';
import { useEffect, type ComponentProps } from 'react';
import { Image, type ImageSourcePropType } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { useMotionPreference } from '@/hooks/useMotionPreference';

// Metro resolves the PNG to an asset id; tsc has no module type for images, hence require.
const appIcon = require('../../assets/images/icon.png') as ImageSourcePropType;

/** Any Ionicons glyph name, for the `icon` props on EmptyState, CenterMessage and toasts. */
export type IconName = ComponentProps<typeof Ionicons>['name'];

/** The WTW app icon, rounded like it sits on a home screen. Decorative: screens say what it means. */
export function AppLogo({ size = 72 }: { size?: number }) {
  return (
    <Image
      source={appIcon}
      style={{ width: size, height: size, borderRadius: size * 0.225 }}
      accessible={false}
      accessibilityIgnoresInvertColors
    />
  );
}

/** The app icon breathing gently while something loads. Still under reduced motion. */
export function PulsingLogo({ size = 88 }: { size?: number }) {
  const reducedMotion = useMotionPreference();
  const s = useSharedValue(1);
  useEffect(() => {
    if (reducedMotion) {
      s.value = 1;
      return;
    }
    s.value = withRepeat(
      withSequence(withTiming(1.05, { duration: 700 }), withTiming(1, { duration: 700 })),
      -1,
    );
    return () => cancelAnimation(s);
  }, [s, reducedMotion]);
  const pulse = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <Animated.View style={pulse} accessible={false} importantForAccessibility="no-hide-descendants">
      <AppLogo size={size} />
    </Animated.View>
  );
}
