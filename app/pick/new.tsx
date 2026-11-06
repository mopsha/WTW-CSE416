import Slider from '@react-native-community/slider';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
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
  { value: 0, label: 'No deadline', accessibilityLabel: 'No deadline' },
];

const THRESHOLDS: readonly ChipOption<number>[] = [
  { value: 50, label: 'Half' },
  { value: 75, label: '75%' },
  { value: 100, label: 'Everyone' },
];

// RN 0.86 exports this component-ref accessor at runtime, but omits it from
// ScrollView.d.ts. getInnerViewNode() is a numeric handle and is not Fabric-safe.
type FormScrollView = ScrollView & { getInnerViewRef(): View | null };

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
  const form = useRef<FormScrollView>(null);
  const attempt = useRef(0);
  const [reveal, setReveal] = useState<{ field: CreatePickField | 'submit'; id: number } | null>(
    null,
  );
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
    const id = ++attempt.current;
    setReveal(null);
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
      Keyboard.dismiss();
      setReveal({ field: found[0]!.field, id });
      haptic.tap();
      return;
    }

    sending.current = true;
    Keyboard.dismiss();
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
      setReveal({ field: 'submit', id });
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
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      >
        <Section
          title="What are we doing?"
          error={problems.category}
          revealId={reveal?.field === 'category' ? reveal.id : undefined}
          form={form}
        >
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
            revealId={reveal?.field === 'customOptions' ? reveal.id : undefined}
            form={form}
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
        <Section
          title="Where"
          error={problems.center}
          revealId={reveal?.field === 'center' ? reveal.id : undefined}
          form={form}
        >
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
                  <Problem
                    message={problems.includeGroupIdeas}
                    label="Include Group Ideas"
                    form={form}
                    revealId={reveal?.field === 'includeGroupIdeas' ? reveal.id : undefined}
                  />
                ) : null}
              </View>
            ) : null}

            <Section
              title="How far"
              value={`${miles.toFixed(1)} mi`}
              hint="Places within this distance of the pin."
              error={problems.radiusM}
              revealId={reveal?.field === 'radiusM' ? reveal.id : undefined}
              form={form}
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
              revealId={reveal?.field === 'priceMax' ? reveal.id : undefined}
              form={form}
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
                revealId={reveal?.field === 'poolSize' ? reveal.id : undefined}
                form={form}
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
              revealId={reveal?.field === 'deadlineAt' ? reveal.id : undefined}
              form={form}
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
              revealId={reveal?.field === 'closeThreshold' ? reveal.id : undefined}
              form={form}
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
          <Problem
            message={submitError}
            label="Could not create Pick"
            form={form}
            revealId={reveal?.field === 'submit' ? reveal.id : undefined}
          >
            <ErrorState
              message={submitError}
              onRetry={() => void submit()}
              retryLabel="Try again"
            />
          </Problem>
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
  revealId,
  form,
}: {
  title: string;
  value?: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  revealId?: number;
  form?: RefObject<FormScrollView | null>;
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
      {error ? <Problem message={error} label={title} revealId={revealId} form={form} /> : null}
      {children}
    </View>
  );
}

// A new keyed native view receives layout even when consecutive errors have the
// same size. Each attempt reveals once; later form resizing cannot replay it.
interface ProblemProps {
  message: string;
  label: string;
  revealId?: number;
  form?: RefObject<FormScrollView | null>;
  children?: ReactNode;
}
function Problem({ message, label, revealId, form, children }: ProblemProps) {
  return (
    <ProblemAnchor key={revealId ?? 'idle'} {...{ message, label, revealId, form, children }} />
  );
}
function ProblemAnchor({ message, label, revealId, form, children }: ProblemProps) {
  const anchor = useRef<View>(null);
  const handled = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  return (
    <View
      ref={anchor}
      collapsable={false}
      accessible={!children}
      accessibilityRole={children ? undefined : 'alert'}
      accessibilityLiveRegion={children ? undefined : 'polite'}
      tabIndex={Platform.OS === 'web' && !children ? -1 : undefined}
      accessibilityLabel={children ? undefined : `${label}. ${message}`}
      onLayout={() => {
        if (revealId === undefined || handled.current) return;
        handled.current = true;
        const node = anchor.current;
        const scroll = form?.current;
        const inner = scroll?.getInnerViewRef();
        let completed = false;
        const announceFailure = () => {
          if (completed) return;
          completed = true;
          if (active.current) AccessibilityInfo.announceForAccessibility(`${label}. ${message}`);
        };
        if (!node || !scroll || !inner) {
          announceFailure();
          return;
        }
        node.measureLayout(
          inner,
          (_, y) => {
            if (completed || !active.current) return;
            completed = true;
            scroll.scrollTo({ y: Math.max(0, y - space.md), animated: false });
            if (children) {
              // ErrorState already announces its Android live region.
              if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(message);
            } else if (Platform.OS === 'web') node.focus();
            else AccessibilityInfo.sendAccessibilityEvent(node, 'focus');
          },
          announceFailure,
        );
      }}
    >
      {children ?? (
        <Text style={styles.error} accessible={false}>
          {message}
        </Text>
      )}
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
