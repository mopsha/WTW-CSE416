import Slider from '@react-native-community/slider';
import { router, useLocalSearchParams } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

import {
  Button,
  Card,
  Chips,
  colors,
  ErrorState,
  fonts,
  Screen,
  space,
  type,
  type ChipOption,
} from '@/components';
import { CustomPlanEditor } from '@/components/CustomPlanEditor';
import type { CustomOption } from '@shared/domain/customPlans.ts';
import { LocationSearch } from '@/components/LocationSearch';
import { PlaceFilterControls } from '@/components/PlaceFilterControls';
import { MapPicker } from '@/components/MapPicker';
import { api } from '@/lib/api';
import { messageOf } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { DEFAULT_CENTER } from '@/lib/locationSearch';
import {
  DEFAULT_POOL_SIZE,
  milesToMeters,
  validateCreatePick,
  type CreatePickField,
  type CreatePickInput,
  type PickCategory,
} from '@shared/domain/createPick.ts';
import type { LatLng } from '@shared/domain/geo.ts';

const CATEGORIES: readonly ChipOption<PickCategory>[] = [
  { value: 'food', label: '🍜 Food' },
  { value: 'activities', label: '🎳 Activities' },
  { value: 'custom', label: '✨ Custom' },
];

const POOL_SIZES: readonly ChipOption<number>[] = [10, 15, 20, 25, 30].map((n) => ({
  value: n,
  label: String(n),
  accessibilityLabel: `${n} places`,
}));

/** Minutes from now, or 0 for no deadline. */
const DEADLINES: readonly ChipOption<number>[] = [
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hr' },
  { value: 180, label: '3 hr' },
  { value: 1440, label: '1 day' },
  { value: 0, label: 'None', accessibilityLabel: 'No deadline' },
];

const THRESHOLDS: readonly ChipOption<number>[] = [
  { value: 50, label: 'Half' },
  { value: 75, label: '75%' },
  { value: 100, label: 'Everyone' },
];

const MIN_MILES = 0.5;
const MAX_MILES = 10;

export default function CreatePickScreen() {
  // From a group (Start a Pick): everyone in it is added when the Pick is created.
  const { groupId, groupName, hangId, hangActivity } = useLocalSearchParams<{
    groupId?: string;
    groupName?: string;
    hangId?: string;
    hangActivity?: string;
  }>();
  const [category, setCategory] = useState<PickCategory>(hangId ? 'activities' : 'food');
  const [customOptions, setCustomOptions] = useState<CustomOption[]>([{ name: '' }, { name: '' }]);
  const [includeSaved, setIncludeSaved] = useState(false);
  const [mix, setMix] = useState<'none' | 'food' | 'activities'>('none');
  const [center, setCenter] = useState<LatLng>(DEFAULT_CENTER);
  const [placeLabel, setPlaceLabel] = useState('SBU Academic Mall');
  const [miles, setMiles] = useState(2);
  const [priceMax, setPriceMax] = useState(-1);
  const [openNow, setOpenNow] = useState(false);
  const [poolSize, setPoolSize] = useState(DEFAULT_POOL_SIZE);
  const [deadlineMin, setDeadlineMin] = useState(60);
  const [closeThreshold, setCloseThreshold] = useState(100);
  const [problems, setProblems] = useState<Partial<Record<CreatePickField, string>>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [createdForOthers, setCreatedForOthers] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const moveCenter = (next: LatLng, label = 'Dropped pin') => {
    setCenter(next);
    setPlaceLabel(label);
    setProblems((p) => ({ ...p, center: undefined }));
  };

  const submit = async () => {
    const input: CreatePickInput = {
      category,
      center,
      radiusM: milesToMeters(miles),
      priceMax: priceMax < 0 ? null : priceMax,
      openNow,
      poolSize:
        category === 'custom'
          ? mix === 'none' && !includeSaved
            ? customOptions.length
            : Math.max(20, customOptions.length)
          : poolSize,
      includeSaved,
      ...(category === 'custom'
        ? { customOptions, ...(mix !== 'none' ? { mixCategory: mix } : {}) }
        : {}),
      // Computed at tap time so "1 hr" means an hour from now, not from when the screen opened.
      deadlineAt: deadlineMin ? new Date(Date.now() + deadlineMin * 60_000).toISOString() : null,
      closeThreshold,
    };
    const found = validateCreatePick(input);
    setProblems(Object.fromEntries(found.map((p) => [p.field, p.message])));
    if (found.length > 0) {
      haptic.tap();
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      if (hangId) {
        const result = await api.hangPick(hangId, input);
        haptic.success();
        if (result.isParticipant)
          router.replace({ pathname: '/pick/[id]/lobby', params: { id: result.pickId } });
        else setCreatedForOthers(true);
        return;
      }
      const { pickId } = groupId
        ? await api.createGroupPick(input, groupId)
        : await api.createPick(input);
      haptic.success();
      // Straight to the Lobby, replacing this form so Back goes to Picks.
      router.replace({ pathname: '/pick/[id]/lobby', params: { id: pickId } });
    } catch (e) {
      setSubmitError(messageOf(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (createdForOthers)
    return (
      <Screen title="Pick created">
        <Text style={{ ...type.body, color: colors.text }}>
          The Pick is ready for the people who are down. Their host can start it.
        </Text>
        <Button label="Back to Picks" onPress={() => router.replace('/')} />
      </Screen>
    );
  return (
    <Screen
      title="New Pick"
      subtitle={
        hangId
          ? `For ${hangActivity ?? 'your hang'}`
          : groupId
            ? `For ${groupName ?? 'your group'}`
            : "Where's the group headed?"
      }
      back
    >
      {groupId ? (
        <Card variant="flat">
          <Text style={styles.hint}>
            Everyone in {groupName ?? 'the group'} is added as soon as you create it.
          </Text>
        </Card>
      ) : null}
      <Section title="What are we picking?" error={problems.category}>
        <Chips
          options={CATEGORIES}
          value={category}
          onChange={setCategory}
          accessibilityLabel="Category"
        />
      </Section>

      {category === 'custom' ? (
        <Section
          title="Your options"
          error={problems.customOptions}
          hint="Add 2–20 ideas. Everyone swipes and votes as usual."
        >
          <CustomPlanEditor options={customOptions} onChange={setCustomOptions} />
          <Chips
            options={[
              { value: 'none' as const, label: 'Only my ideas' },
              { value: 'food' as const, label: 'Add nearby food' },
              { value: 'activities' as const, label: 'Add nearby activities' },
            ]}
            value={mix}
            onChange={setMix}
            accessibilityLabel="Mix nearby places"
          />
        </Section>
      ) : null}
      <Card>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>
            {hangId ? 'Include the host’s saved places' : 'Include my saved places'}
          </Text>
          <Switch
            value={includeSaved}
            onValueChange={setIncludeSaved}
            accessibilityLabel={
              hangId
                ? 'Include the Pick host’s saved places inside the radius'
                : 'Include my saved places inside the radius'
            }
          />
        </View>
      </Card>
      <Section title="Where" error={problems.center}>
        <LocationSearch label={placeLabel} onPick={moveCenter} />
        <MapPicker
          center={center}
          radiusM={milesToMeters(miles)}
          onChangeCenter={(c) => moveCenter(c)}
        />
      </Section>

      <Section
        title="How far"
        value={`${miles.toFixed(1)} mi`}
        hint="Places within this distance of the pin."
        error={problems.radiusM}
      >
        <Slider
          minimumValue={MIN_MILES}
          maximumValue={MAX_MILES}
          step={0.5}
          value={miles}
          onValueChange={setMiles}
          onSlidingComplete={() => haptic.tick()}
          minimumTrackTintColor={colors.primary}
          maximumTrackTintColor={colors.border}
          thumbTintColor={colors.primary}
          style={styles.slider}
          accessibilityLabel="Search radius in miles"
          accessibilityValue={{
            min: MIN_MILES,
            max: MAX_MILES,
            now: miles,
            text: `${miles} miles`,
          }}
        />
      </Section>

      <Section
        title="Place filters"
        hint="Unknown prices or hours are excluded when that filter is set."
        error={problems.priceMax}
      >
        <PlaceFilterControls
          priceMax={priceMax}
          openNow={openNow}
          onPrice={setPriceMax}
          onOpen={setOpenNow}
        />
      </Section>
      {category !== 'custom' ? (
        <Section
          title="How many places"
          hint="Fewer is faster to swipe; more gives more options."
          error={problems.poolSize}
        >
          <Chips
            options={POOL_SIZES}
            value={poolSize}
            onChange={setPoolSize}
            accessibilityLabel="Pool size"
          />
        </Section>
      ) : null}

      <Section
        title="Deadline"
        hint="Swiping closes then, even if not everyone is done."
        error={problems.deadlineAt}
      >
        <Chips
          options={DEADLINES}
          value={deadlineMin}
          onChange={setDeadlineMin}
          accessibilityLabel="Deadline"
        />
      </Section>

      <Section
        title="Close early when"
        hint="…this many people have finished swiping."
        error={problems.closeThreshold}
      >
        <Chips
          options={THRESHOLDS}
          value={closeThreshold}
          onChange={setCloseThreshold}
          accessibilityLabel="Close threshold"
        />
      </Section>

      {submitError ? (
        <ErrorState message={submitError} onRetry={() => void submit()} retryLabel="Try again" />
      ) : null}

      <Button
        label="Create Pick"
        icon="flame"
        loading={submitting}
        onPress={() => void submit()}
        accessibilityHint="Creates the Pick so you can invite friends"
      />
    </Screen>
  );
}

function Section({
  title,
  value,
  hint,
  error,
  children,
}: {
  title: string;
  value?: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle} accessibilityRole="header">
          {title}
        </Text>
        {value ? <Text style={styles.sectionValue}>{value}</Text> : null}
      </View>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {children}
      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  sectionTitle: { fontFamily: fonts.bold, fontSize: 17, color: colors.text },
  sectionValue: { fontFamily: fonts.bold, fontSize: 17, color: colors.primary },
  hint: { ...type.caption, color: colors.muted, marginTop: -space.xs },
  slider: { height: 44 },
  error: { ...type.caption, color: colors.danger },
});
