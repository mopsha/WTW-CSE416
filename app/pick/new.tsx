import Slider from '@react-native-community/slider';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import {
  Button,
  IconButton,
  radius,
  Chips,
  colors,
  ErrorState,
  fonts,
  MIN_TARGET,
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
  { value: 'food', label: 'Food' },
  { value: 'activities', label: 'Activities' },
  { value: 'both', label: 'Food + Activities' },
  { value: 'custom', label: 'Custom' },
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
  const [includeGroupIdeas, setIncludeGroupIdeas] = useState(false);
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

  const [moreOptions, setMoreOptions] = useState(false);
  const [expandedMap, setExpandedMap] = useState(false);
  const sending = useRef(false);
  const form = useRef<ScrollView>(null);
  const revealError = useRef(false);
  const optionSummary = [
    miles !== 2 ? `${miles.toFixed(1)} mi` : '',
    includeSaved ? 'Saved places' : '',
    includeGroupIdeas && groupId && !hangId ? 'Group Ideas' : '',
    priceMax >= 0 ? (priceMax === 0 ? 'Free' : '$'.repeat(priceMax)) : '',
    openNow ? 'Open now' : '',
    category !== 'custom' && poolSize !== DEFAULT_POOL_SIZE ? `${poolSize} places` : '',
    deadlineMin !== 60 ? DEADLINES.find((d) => d.value === deadlineMin)?.label : '',
    closeThreshold !== 100 ? `${closeThreshold}% finished` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const moveCenter = (next: LatLng, label = 'Dropped pin') => {
    setCenter(next);
    setPlaceLabel(label);
    setProblems((p) => ({ ...p, center: undefined }));
  };

  const submit = async () => {
    if (sending.current) return;
    const input: CreatePickInput = {
      category,
      center,
      radiusM: milesToMeters(miles),
      priceMax: priceMax < 0 ? null : priceMax,
      openNow,
      poolSize:
        category === 'custom'
          ? includeGroupIdeas && groupId && !hangId
            ? 30
            : mix === 'none' && !includeSaved && !includeGroupIdeas
              ? customOptions.length
              : Math.max(20, customOptions.length)
          : poolSize,
      includeSaved,
      ...(groupId && !hangId ? { groupId, includeGroupIdeas } : {}),
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
      if (found.some((p) => !['category', 'center', 'customOptions'].includes(p.field)))
        setMoreOptions(true);
      haptic.tap();
      return;
    }

    sending.current = true;
    Keyboard.dismiss();
    setSubmitting(true);
    revealError.current = false;
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
      revealError.current = true;
      setSubmitError(messageOf(e));
    } finally {
      sending.current = false;
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
    <Screen scroll={false} contentStyle={styles.frame}>
      <View style={styles.header}>
        <IconButton
          icon="chevron-back"
          accessibilityLabel="Back"
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace('/');
          }}
        />
        <View style={styles.identity}>
          <Text style={styles.pageTitle} accessibilityRole="header">
            New Pick
          </Text>
          {hangId || groupId ? (
            <Text style={styles.hint}>
              {hangId ? `For ${hangActivity ?? 'your hang'}` : `For ${groupName ?? 'your group'}`}
            </Text>
          ) : null}
        </View>
      </View>
      <ScrollView
        ref={form}
        onContentSizeChange={() => {
          if (!revealError.current || !submitError) return;
          revealError.current = false;
          form.current?.scrollToEnd({ animated: false });
          // ErrorState's live region handles Android; announce the new error on iOS.
          if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(submitError);
        }}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      >
        <Section title="What are we doing?" error={problems.category}>
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
        <Section title="Where" error={problems.center}>
          <LocationSearch label={placeLabel} onPick={moveCenter} />
          <MapPicker
            height={expandedMap ? 320 : Platform.OS === 'web' ? 240 : 144}
            center={center}
            radiusM={milesToMeters(miles)}
            onChangeCenter={(c) => moveCenter(c)}
          />
          <Pressable
            style={styles.textAction}
            accessibilityRole="button"
            accessibilityLabel={expandedMap ? 'Collapse map' : 'Expand map'}
            accessibilityState={{ expanded: expandedMap }}
            onPress={() => {
              Keyboard.dismiss();
              setExpandedMap((v) => !v);
            }}
          >
            <Text style={styles.actionText}>{expandedMap ? 'Collapse map' : 'Expand map'}</Text>
          </Pressable>
        </Section>
        <Section title="Who's joining?">
          <Text style={styles.hint}>
            {hangId
              ? 'The Pick is for the people who are down.'
              : groupId
                ? `Everyone in ${groupName ?? 'the group'} is added as soon as you create it.`
                : 'Invite friends after creating your Pick.'}
          </Text>
        </Section>
        <Pressable
          style={styles.disclosure}
          accessibilityRole="button"
          accessibilityLabel="More options"
          accessibilityValue={optionSummary ? { text: optionSummary } : undefined}
          accessibilityState={{ expanded: moreOptions }}
          onPress={() => setMoreOptions((v) => !v)}
        >
          <View style={styles.identity}>
            <Text style={styles.sectionTitle}>More options</Text>
            <Text style={styles.hint}>
              {optionSummary || 'Radius, saved places, filters and timing'}
            </Text>
          </View>
          <Text style={styles.actionText}>{moreOptions ? '−' : '+'}</Text>
        </Pressable>
        {moreOptions ? (
          <View style={styles.options}>
            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>
                  {hangId ? 'Include the host’s saved places' : 'Include my saved places'}
                </Text>
                <Switch
                  style={{ minHeight: MIN_TARGET, minWidth: MIN_TARGET }}
                  value={includeSaved}
                  onValueChange={setIncludeSaved}
                  accessibilityLabel={
                    hangId
                      ? 'Include the Pick host’s saved places inside the radius'
                      : 'Include my saved places inside the radius'
                  }
                />
              </View>
            </View>
            {groupId && !hangId ? (
              <View style={styles.section}>
                <View style={styles.sectionHead}>
                  <Text style={styles.sectionTitle}>Include Group Ideas</Text>
                  <Switch
                    style={{ minHeight: MIN_TARGET, minWidth: MIN_TARGET }}
                    disabled={submitting}
                    value={includeGroupIdeas}
                    onValueChange={setIncludeGroupIdeas}
                    accessibilityLabel="Include Group Ideas"
                  />
                </View>
                <Text style={styles.hint}>
                  Mix your group’s matching ideas into this Pick. Distance, price and Open Now apply
                  to public places only.
                </Text>
                {problems.includeGroupIdeas ? (
                  <ErrorState message={problems.includeGroupIdeas} />
                ) : null}
              </View>
            ) : null}

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
          </View>
        ) : null}
        {submitError ? (
          <ErrorState message={submitError} onRetry={() => void submit()} retryLabel="Try again" />
        ) : null}
      </ScrollView>
      <View style={styles.footer}>
        <Button
          label="Create Pick"
          icon="flame"
          loading={submitting}
          onPress={() => void submit()}
          accessibilityHint="Creates the Pick so you can invite friends"
        />
      </View>
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
    <View style={styles.section}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { padding: 0, paddingBottom: 0, gap: 0 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  identity: { flex: 1, gap: space.xs },
  pageTitle: { ...type.heading, color: colors.text },
  scroll: { flex: 1 },
  content: { padding: space.lg, gap: space.xl, paddingBottom: space.xl },
  section: { gap: space.md },
  sectionHead: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  disclosure: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: MIN_TARGET,
    paddingVertical: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  options: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.xl,
  },
  textAction: { minHeight: MIN_TARGET, justifyContent: 'center', alignSelf: 'flex-start' },
  actionText: { ...type.body, color: colors.primary },
  footer: {
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    gap: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  sectionTitle: { fontFamily: fonts.bold, fontSize: 17, color: colors.text, flexShrink: 1 },
  sectionValue: { fontFamily: fonts.bold, fontSize: 17, color: colors.primary },
  hint: { ...type.caption, color: colors.muted },
  slider: { height: 44 },
  error: { ...type.caption, color: colors.danger },
});
