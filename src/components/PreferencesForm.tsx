import {
  ACTIVITY_TYPE_OPTIONS,
  CATEGORY_OPTIONS,
  DISTANCE_OPTIONS,
  FOOD_TYPE_OPTIONS,
  PRICE_OPTIONS,
  type Preferences,
} from '@shared/domain/preferences.ts';
import type { ReactNode } from 'react';
import { StyleSheet, Text } from 'react-native';

import { Card } from './Card';
import { Chips, MultiChips, type ChipOption } from './Chips';
import { colors, fonts, space, type } from './theme';

const FOOD = new Set(FOOD_TYPE_OPTIONS.map((o) => o.value));

/** 0 stands for "no preference" (null) so the single-choice chips can offer it. */
const ANY: ChipOption<number> = { value: 0, label: 'Any' };
const PRICES = [
  ANY,
  ...PRICE_OPTIONS.map((o) => ({ ...o, accessibilityLabel: `Up to ${o.label}` })),
];
const DISTANCES = [
  ANY,
  ...DISTANCE_OPTIONS.map((o) => ({ ...o, accessibilityLabel: `Within ${o.label}` })),
];

/**
 * The preference survey (FR-02): onboarding and "Edit preferences" on the Profile tab.
 * Every question is optional; nothing here is required to use the app.
 */
export function PreferencesForm({
  value,
  onChange,
}: {
  value: Preferences;
  onChange: (next: Preferences) => void;
}) {
  const likedFood = value.types.filter((t) => FOOD.has(t));
  const likedActivities = value.types.filter((t) => !FOOD.has(t));

  return (
    <>
      <Section title="What are you up for?" hint="Pick one or both.">
        <MultiChips
          options={CATEGORY_OPTIONS}
          values={value.categories}
          onChange={(categories) => onChange({ ...value, categories })}
          accessibilityLabel="What you're up for"
        />
      </Section>
      <Section title="Food you love">
        <MultiChips
          options={FOOD_TYPE_OPTIONS}
          values={likedFood}
          onChange={(food) =>
            onChange({
              ...value,
              types: [...food, ...likedActivities],
              // Loving something takes it off the skip list.
              dislikedTypes: value.dislikedTypes.filter((t) => !food.includes(t)),
            })
          }
          accessibilityLabel="Food you love"
        />
      </Section>
      <Section title="Food you'd rather skip">
        <MultiChips
          options={FOOD_TYPE_OPTIONS}
          values={value.dislikedTypes}
          onChange={(dislikedTypes) =>
            onChange({
              ...value,
              dislikedTypes,
              types: value.types.filter((t) => !dislikedTypes.includes(t)),
            })
          }
          accessibilityLabel="Food you'd rather skip"
        />
      </Section>
      <Section title="Things you like doing">
        <MultiChips
          options={ACTIVITY_TYPE_OPTIONS}
          values={likedActivities}
          onChange={(activities) => onChange({ ...value, types: [...likedFood, ...activities] })}
          accessibilityLabel="Things you like doing"
        />
      </Section>
      <Section title="Budget" hint="The most you usually want to spend.">
        <Chips
          options={PRICES}
          value={value.priceMax ?? 0}
          onChange={(n) => onChange({ ...value, priceMax: n || null })}
          accessibilityLabel="Budget"
        />
      </Section>
      <Section title="How far you'll go">
        <Chips
          options={DISTANCES}
          value={value.maxDistanceM ?? 0}
          onChange={(n) => onChange({ ...value, maxDistanceM: n || null })}
          accessibilityLabel="How far you'll go"
        />
      </Section>
    </>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <Card>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {children}
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: fonts.bold, fontSize: 17, color: colors.text },
  hint: { ...type.caption, color: colors.muted, marginTop: -space.xs },
});
