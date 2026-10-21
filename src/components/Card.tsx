import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { haptic } from '@/lib/haptics';

import { colors, MIN_TARGET, radius, space } from './theme';

interface Props {
  children: ReactNode;
  /** Makes the whole card tappable (then give it an accessibilityLabel). */
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** "flat" drops the border, for cards nested inside another surface. */
  variant?: 'default' | 'flat';
  style?: StyleProp<ViewStyle>;
}

/** A rounded surface that groups related content. */
export function Card({
  children,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  variant = 'default',
  style,
}: Props) {
  const look = [styles.card, variant === 'flat' && styles.flat, style];
  if (!onPress) return <View style={look}>{children}</View>;
  return (
    <Pressable
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [...look, styles.tappable, pressed && styles.pressed]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    gap: space.sm,
  },
  flat: { borderWidth: 0, backgroundColor: colors.cardHi },
  tappable: { minHeight: MIN_TARGET },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
});
