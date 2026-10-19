import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fonts } from './theme';

export interface Toast {
  id: number;
  emoji: string;
  text: string;
  color?: string;
}

/** A pill that drops in from the top, like an in-app notification. Re-key it per toast. */
export function ActivityToast({ toast }: { toast: Toast }) {
  const insets = useSafeAreaInsets();
  const y = useSharedValue(-120);
  const o = useSharedValue(0);

  useEffect(() => {
    y.value = withSpring(0, { damping: 16, stiffness: 180 });
    o.value = withTiming(1, { duration: 180 });
    const t = setTimeout(() => {
      y.value = withTiming(-120, { duration: 260 });
      o.value = withTiming(0, { duration: 260 });
    }, 2600);
    return () => clearTimeout(t);
  }, [o, y]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: y.value }],
    opacity: o.value,
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.wrap, { top: insets.top + 8 }, style]}
      accessibilityLiveRegion="polite"
    >
      <View style={[styles.dot, { backgroundColor: toast.color ?? colors.primary }]}>
        <Text style={styles.emoji}>{toast.emoji}</Text>
      </View>
      <Text style={styles.text} numberOfLines={2}>
        {toast.text}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: 'rgba(27, 22, 34, 0.96)',
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  dot: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 18 },
  text: { flex: 1, fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
});
