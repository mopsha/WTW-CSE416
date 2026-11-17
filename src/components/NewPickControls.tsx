/** Creation-only presentation; domain values and payloads belong to the route. */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Switch, Text, useWindowDimensions, View } from 'react-native';
import type { ReactNode } from 'react';
import type { PickCategory } from '@shared/domain/createPick.ts';
import { colors, fonts, MIN_TARGET, radius, space, type, type ChipOption } from '@/components';
import { haptic } from '@/lib/haptics';

const categories = [
  { value: 'food', label: 'Food', icon: 'restaurant-outline' },
  { value: 'activities', label: 'Activities', icon: 'basketball-outline' },
  { value: 'both', label: 'Food + Activities', icon: 'sparkles-outline' },
  { value: 'custom', label: 'Custom', icon: 'create-outline' },
] as const;
export function CategoryCards({
  value,
  onChange,
  disabled,
}: {
  value: PickCategory;
  onChange: (value: PickCategory) => void;
  disabled: boolean;
}) {
  const { width, fontScale } = useWindowDimensions();
  const singleColumn = width < 350 || fontScale >= 1.5;
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Category" style={s.grid}>
      {categories.map((category) => (
        <Pressable
          key={category.value}
          accessibilityRole="radio"
          accessibilityLabel={category.label}
          accessibilityState={{ selected: value === category.value, disabled }}
          disabled={disabled}
          onPress={() => {
            haptic.tap();
            onChange(category.value);
          }}
          style={({ pressed }) => [
            s.category,
            { width: singleColumn ? '100%' : '48%' },
            value === category.value && s.selected,
            pressed && s.pressed,
          ]}
        >
          <View style={s.categoryTop}>
            <Ionicons name={category.icon} size={25} color={colors.primary} />
            {value === category.value ? (
              <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
            ) : null}
          </View>
          <Text style={s.label}>{category.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}
export function SettingsGroup({ children }: { children: ReactNode }) {
  return <View style={s.group}>{children}</View>;
}
export function SettingRow({
  label,
  value,
  icon,
  onPress,
  disabled = false,
  children,
}: {
  label: string;
  value: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const body = (
    <>
      <Ionicons name={icon} size={20} color={colors.primary} />
      <View style={s.words}>
        <Text style={s.label}>{label}</Text>
        <Text style={s.value}>{value}</Text>
      </View>
      {onPress ? <Ionicons name="chevron-forward" size={18} color={colors.muted} /> : null}
    </>
  );
  return (
    <View>
      {onPress ? (
        <Pressable
          onPress={onPress}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityValue={{ text: value }}
          accessibilityState={{ disabled }}
          style={({ pressed }) => [s.row, pressed && s.pressed]}
        >
          {body}
        </Pressable>
      ) : (
        <View style={s.row}>{body}</View>
      )}
      {children}
    </View>
  );
}
export function SettingSwitch({
  label,
  hint,
  value,
  onChange,
  disabled,
  accessibilityLabel = label,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled: boolean;
  accessibilityLabel?: string;
}) {
  const { width, fontScale } = useWindowDimensions();
  return (
    <View style={[s.row, (fontScale >= 1.5 || width < 350) && s.stacked]}>
      <View style={s.words}>
        <Text style={s.label}>{label}</Text>
        {hint ? <Text style={s.value}>{hint}</Text> : null}
      </View>
      <View style={s.switchTarget}>
        <Switch
          hitSlop={{ top: space.sm, bottom: space.sm }}
          value={value}
          onValueChange={onChange}
          disabled={disabled}
          accessibilityLabel={accessibilityLabel}
          accessibilityHint={hint}
          accessibilityState={{ disabled }}
        />
      </View>
    </View>
  );
}
export function ChoiceList({
  options,
  value,
  onChange,
  accessibilityLabel,
}: {
  options: readonly ChipOption<number>[];
  value: number;
  onChange: (value: number) => void;
  accessibilityLabel: string;
}) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel}>
      {options.map((option) => (
        <Pressable
          key={option.value}
          accessibilityRole="radio"
          accessibilityLabel={option.accessibilityLabel ?? option.label}
          accessibilityState={{ selected: value === option.value }}
          onPress={() => {
            haptic.tap();
            onChange(option.value);
          }}
          style={({ pressed }) => [s.row, pressed && s.pressed]}
        >
          <Text style={[s.label, s.words]}>{option.label}</Text>
          {value === option.value ? (
            <Ionicons name="checkmark" size={22} color={colors.primary} />
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}
const s = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: space.sm },
  category: {
    minHeight: MIN_TARGET * 2,
    padding: space.md,
    gap: space.sm,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  categoryTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  selected: { borderColor: colors.primary, backgroundColor: colors.cardHi },
  group: { borderRadius: radius.lg, backgroundColor: colors.card, overflow: 'hidden' },
  row: {
    minHeight: MIN_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  words: { flex: 1, flexShrink: 1, gap: space.xs },
  label: { ...type.body, fontFamily: fonts.medium, color: colors.text },
  value: { ...type.caption, color: colors.muted },
  switchTarget: {
    minWidth: MIN_TARGET,
    minHeight: MIN_TARGET,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stacked: { flexDirection: 'column', alignItems: 'stretch' },
  pressed: { opacity: 0.7 },
});
