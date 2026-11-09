import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  BIRTHDAY_DAYS,
  BIRTHDAY_MONTHS,
  birthdayLabel,
  parseBirthday,
  type Birthday,
} from '@shared/api/birthdays.ts';
import { Button } from './Button';
import { colors, MIN_TARGET, radius, space, type } from './theme';

export function BirthdayField({
  value,
  onChange,
  disabled = false,
}: {
  value: Birthday | null;
  onChange: (birthday: Birthday) => void;
  disabled?: boolean;
}) {
  const [monthsOpen, setMonthsOpen] = useState(false);
  let valid: Birthday | null = null;
  try {
    valid = parseBirthday(value);
  } catch {
    /* Incomplete drafts are validated on Save. */
  }
  const month = value?.month ?? 0;
  const day = value?.day ?? 0;
  const maxDay = BIRTHDAY_DAYS[month - 1];
  const invalidDay = !!day && (!maxDay || day > maxDay);
  return (
    <View style={s.root}>
      <Text style={s.label}>Birthday{valid ? ` · ${birthdayLabel(valid)}` : ''}</Text>
      <View style={s.row}>
        <View style={s.month}>
          <Text style={s.label}>Month</Text>
          <Button
            label={BIRTHDAY_MONTHS[month - 1] ?? 'Choose month'}
            accessibilityLabel="Birthday month"
            accessibilityHint="Opens month choices. No year is requested."
            variant="link"
            size="compact"
            disabled={disabled}
            onPress={() => setMonthsOpen(!monthsOpen)}
          />
        </View>
        <View style={s.day}>
          <Text style={s.label}>Day</Text>
          <TextInput
            accessibilityLabel="Birthday day"
            accessibilityHint={
              maxDay ? `Enter a day from 1 to ${maxDay}` : 'Choose a month and enter its day'
            }
            placeholder="DD"
            placeholderTextColor={colors.muted}
            style={s.input}
            keyboardType="number-pad"
            autoComplete="off"
            maxLength={2}
            value={day ? String(day) : ''}
            editable={!disabled}
            onChangeText={(text) => {
              if (!disabled) onChange({ month, day: Number(text.replace(/\D/g, '')) });
            }}
          />
        </View>
      </View>
      {monthsOpen ? (
        <View
          style={s.months}
          accessibilityRole="radiogroup"
          accessibilityLabel="Birthday month choices"
        >
          {BIRTHDAY_MONTHS.map((label, i) => (
            <Pressable
              key={label}
              accessibilityRole="radio"
              accessibilityLabel={label}
              accessibilityState={{ checked: month === i + 1, disabled }}
              disabled={disabled}
              onPress={() => {
                if (disabled) return;
                onChange({ month: i + 1, day });
                setMonthsOpen(false);
              }}
              style={[s.choice, month === i + 1 && s.selected]}
            >
              <Text style={s.choiceLabel}>{label.slice(0, 3)}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {invalidDay ? (
        <Text accessibilityLiveRegion="polite" style={s.error}>
          Choose a day from 1 to {maxDay ?? 31} for your birthday month.
        </Text>
      ) : null}
      <Text style={s.caption}>
        Add your birthday so we can remind your friends when it&apos;s time to celebrate.
      </Text>
      <Text style={s.caption}>
        Reminders aren’t available yet. We only collect month and day. Sharing with friends is off
        by default.
      </Text>
    </View>
  );
}
const s = StyleSheet.create({
  root: { gap: space.xs },
  label: { ...type.caption, color: colors.muted },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  month: { flex: 1, alignItems: 'flex-start' },
  day: { minWidth: MIN_TARGET + space.xl },
  input: {
    ...type.body,
    color: colors.text,
    minHeight: MIN_TARGET,
    paddingHorizontal: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  months: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  choice: {
    minHeight: MIN_TARGET,
    minWidth: MIN_TARGET,
    flexBasis: '23%',
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.card,
  },
  selected: { backgroundColor: colors.primary },
  choiceLabel: { ...type.caption, color: colors.text },
  caption: { ...type.caption, color: colors.muted },
  error: { ...type.caption, color: colors.danger },
});
