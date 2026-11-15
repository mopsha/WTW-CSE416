import Slider from '@react-native-community/slider';
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import type { DiscoverFilter } from '@/lib/discover';
import {
  ACTIVITY_TYPES,
  CUISINES,
  FOOD_TYPES,
  milesToMeters,
  METERS_PER_MILE,
  resetDiscoverFilters,
  type DiscoverFilters,
} from '@/lib/discoverFilters';
import { Button } from './Button';
import { Sheet } from './TabUi';
import { colors, fonts, MIN_TARGET, radius, space, type } from './theme';

function Options({
  label,
  options,
  values,
  onChange,
  anyLabel,
  multiple = true,
}: {
  label: string;
  options: readonly { value: string; label: string }[];
  values: readonly string[];
  onChange(values: string[]): void;
  anyLabel: string;
  multiple?: boolean;
}) {
  return (
    <View style={s.section} accessibilityLabel={label}>
      <Text style={s.heading} accessibilityRole="header">
        {label}
      </Text>
      <View style={s.options}>
        {[{ value: '', label: anyLabel }, ...options].map((o) => {
          const selected = o.value ? values.includes(o.value) : !values.length;
          return (
            <Pressable
              key={o.value}
              accessibilityRole={multiple ? 'checkbox' : 'radio'}
              accessibilityLabel={o.label}
              accessibilityState={{ checked: selected }}
              onPress={() =>
                onChange(
                  !o.value
                    ? []
                    : selected
                      ? multiple
                        ? values.filter((v) => v !== o.value)
                        : [...values]
                      : multiple
                        ? [...values, o.value]
                        : [o.value],
                )
              }
              style={({ pressed }) => [s.chip, selected && s.selected, pressed && s.pressed]}
            >
              <Text style={[s.label, selected && s.selectedText]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
/** A fresh draft per opening; only Show places commits it. */
export function DiscoverFilterSheet({
  tab,
  applied,
  onClose,
  onApply,
}: {
  tab: DiscoverFilter;
  applied: DiscoverFilters;
  onClose(): void;
  onApply(value: DiscoverFilters): void;
}) {
  const [draft, setDraft] = useState(applied);
  const patch = (next: Partial<DiscoverFilters>) =>
    setDraft((current) => ({ ...current, ...next }));
  const distance = draft.radiusM / METERS_PER_MILE;
  return (
    <Sheet
      visible
      title="Filters"
      onClose={onClose}
      headerRight={
        <Button
          label="Reset"
          variant="link"
          size="compact"
          onPress={() => setDraft(resetDiscoverFilters(draft, tab))}
        />
      }
      footer={<Button label="Show places" onPress={() => onApply(draft)} />}
    >
      {tab === 'food' ? (
        <>
          <Options
            label="Cuisine"
            anyLabel="Any cuisine"
            options={CUISINES}
            values={draft.cuisines}
            onChange={(cuisines) => patch({ cuisines })}
          />
          <Options
            label="Food type"
            anyLabel="Any food type"
            options={FOOD_TYPES}
            values={draft.foodTypes}
            onChange={(foodTypes) => patch({ foodTypes })}
          />
          <Text style={s.note}>
            Matches any selected cuisine and any selected food type. Both sections must match when
            used together.
          </Text>
        </>
      ) : tab === 'activities' ? (
        <Options
          label="Activity type"
          anyLabel="Any activity"
          options={ACTIVITY_TYPES}
          values={draft.activityTypes}
          onChange={(activityTypes) => patch({ activityTypes })}
        />
      ) : null}
      <Options
        multiple={false}
        label="Price"
        anyLabel="Any price"
        options={[0, 1, 2, 3, 4].map((n) => ({
          value: String(n),
          label: n === 0 ? 'Free' : `Up to ${'$'.repeat(n)}`,
        }))}
        values={draft.priceMax < 0 ? [] : [String(draft.priceMax)]}
        onChange={(values) => patch({ priceMax: values.length ? Number(values.at(-1)) : -1 })}
      />
      <Text style={s.note}>Maximum price. Unknown prices do not match a price limit.</Text>
      <Options
        multiple={false}
        label="Minimum rating"
        anyLabel="Any rating"
        options={[3.5, 4, 4.5].map((n) => ({ value: String(n), label: `${n.toFixed(1)}+` }))}
        values={draft.minRating ? [String(draft.minRating)] : []}
        onChange={(values) => patch({ minRating: values.length ? Number(values.at(-1)) : 0 })}
      />
      <Text style={s.note}>Unrated places are included only with Any rating.</Text>
      <View style={s.section}>
        <View style={s.row}>
          <Text style={s.heading} accessibilityRole="header">
            Distance
          </Text>
          <Text style={s.label}>{distance.toFixed(1)} mi</Text>
        </View>
        <Slider
          value={distance}
          minimumValue={1}
          maximumValue={25}
          step={0.1}
          minimumTrackTintColor={colors.primary}
          maximumTrackTintColor={colors.border}
          thumbTintColor={colors.text}
          accessibilityLabel="Search distance in miles"
          accessibilityValue={{
            min: 1,
            max: 25,
            now: distance,
            text: `${distance.toFixed(1)} miles`,
          }}
          onValueChange={(miles) => patch({ radiusM: milesToMeters(miles) })}
          style={s.slider}
        />
        <View style={s.options}>
          {[1, 5, 10, 25].map((miles) => (
            <Button
              key={miles}
              label={`${miles} mi`}
              variant="secondary"
              size="compact"
              onPress={() => patch({ radiusM: milesToMeters(miles) })}
            />
          ))}
        </View>
        <Text style={s.note}>Straight-line radius from Stony Brook, not driving distance.</Text>
      </View>
      <View style={s.section}>
        <Text style={s.heading} accessibilityRole="header">
          Opening hours
        </Text>
        <View style={s.row}>
          <Text style={s.label}>Open now</Text>
          <Switch
            accessibilityLabel="Only places known to be open now"
            value={draft.openNow}
            onValueChange={(openNow) => patch({ openNow })}
          />
        </View>
      </View>
      <Text style={s.note}>
        Filters apply to a limited nearby selection. Some matching places may not be returned.
      </Text>
    </Sheet>
  );
}
const s = StyleSheet.create({
  section: {
    gap: space.sm,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  heading: { ...type.body, fontFamily: fonts.semibold, color: colors.text },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    maxWidth: '100%',
    minHeight: MIN_TARGET,
    minWidth: MIN_TARGET,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    backgroundColor: colors.card,
  },
  selected: { backgroundColor: colors.primary, borderColor: colors.primary },
  label: { ...type.caption, fontFamily: fonts.medium, color: colors.text },
  selectedText: { color: colors.primaryText },
  pressed: { opacity: 0.65 },
  note: { ...type.caption, color: colors.muted },
  row: {
    minHeight: MIN_TARGET,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space.sm,
    flexWrap: 'wrap',
  },
  slider: { minHeight: MIN_TARGET, width: '100%' },
});
