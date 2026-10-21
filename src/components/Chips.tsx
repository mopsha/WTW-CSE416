import { Pressable, StyleSheet, Text, View } from 'react-native';

import { haptic } from '@/lib/haptics';

import { colors, fonts, MIN_TARGET, radius, space } from './theme';

export interface ChipOption<T extends string | number> {
  value: T;
  label: string;
  /** Read by screen readers instead of the label (e.g. "20 places" for "20"). */
  accessibilityLabel?: string;
}

interface Props<T extends string | number> {
  options: readonly ChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Names the group for screen readers (e.g. "Pool size"). */
  accessibilityLabel: string;
}

/** Pick one of a few options (category, pool size, deadline...). */
export function Chips<T extends string | number>({
  options,
  value,
  onChange,
  accessibilityLabel,
}: Props<T>) {
  return (
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            onPress={() => {
              if (selected) return;
              haptic.tick();
              onChange(o.value);
            }}
            accessibilityRole="radio"
            accessibilityLabel={o.accessibilityLabel ?? o.label}
            accessibilityState={{ selected, checked: selected }}
            style={({ pressed }) => [
              styles.chip,
              selected && styles.selected,
              pressed && !selected && styles.pressed,
            ]}
          >
            <Text style={[styles.label, selected && styles.selectedLabel]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    minHeight: MIN_TARGET,
    minWidth: MIN_TARGET,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selected: { backgroundColor: colors.primary, borderColor: colors.primary },
  pressed: { opacity: 0.75 },
  label: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
  selectedLabel: { color: colors.primaryText },
});
