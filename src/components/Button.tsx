import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { haptic } from '@/lib/haptics';

import { colors, fonts, MIN_TARGET, radius } from './theme';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  /**
   * primary: solid coral (one per screen) · secondary: outlined surface ·
   * link: text only · danger: destructive actions (Cancel Pick, Sign out)
   */
  variant?: 'primary' | 'secondary' | 'link' | 'danger';
  /** An Ionicons name shown before the label. */
  icon?: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
  loading?: boolean;
  /** Defaults to `label`. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: ViewStyle;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  disabled = false,
  loading = false,
  accessibilityLabel,
  accessibilityHint,
  style,
}: ButtonProps) {
  const inactive = disabled || loading;
  const textColor =
    variant === 'primary'
      ? colors.primaryText
      : variant === 'danger'
        ? colors.no
        : variant === 'link'
          ? colors.primary
          : colors.text;

  const iconOnly = !label && !!icon;
  const content = loading ? (
    <ActivityIndicator color={textColor} />
  ) : (
    <View style={styles.row}>
      {icon ? <Ionicons name={icon} size={18} color={textColor} /> : null}
      {!iconOnly ? <Text style={[styles.label, { color: textColor }]}>{label}</Text> : null}
    </View>
  );

  return (
    <Pressable
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        variant === 'primary' && styles.primaryShadow,
        variant === 'secondary' && styles.secondary,
        variant === 'danger' && styles.danger,
        inactive && styles.disabled,
        pressed && !inactive && styles.pressed,
        style,
      ]}
    >
      <View style={[styles.fill, iconOnly && { paddingHorizontal: 0, minWidth: MIN_TARGET }]}>
        {content}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.pill },
  fill: {
    minHeight: MIN_TARGET + 6,
    borderRadius: radius.pill,
    paddingHorizontal: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { fontFamily: fonts.semibold, fontSize: 16 },
  primaryShadow: { backgroundColor: colors.primary },
  secondary: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  danger: { backgroundColor: colors.dangerBg },
  disabled: { opacity: 0.4 },
  pressed: { transform: [{ scale: 0.97 }] },
});
