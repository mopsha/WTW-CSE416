import { PlanTimeSheet } from '@/components/PlanTimeSheet';
import { formatPlanTime } from '@/lib/plans';
import { useAuth } from '@/hooks/useAuth';
import {
  CategoryCards,
  ChoiceList,
  SettingRow,
  SettingSwitch,
  SettingsGroup,
} from '@/components/NewPickControls';
import { NewPickLocationEditor } from '@/components/NewPickLocationEditor';
import { Sheet } from '@/components/TabUi';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  AccessibilityInfo,
  Keyboard,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  Button,
  IconButton,
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
import { PlaceFilterControls } from '@/components/PlaceFilterControls';
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

export default function CreatePickScreen() {
  const { session } = useAuth();
  const params = useLocalSearchParams<{
    groupId?: string;
    groupName?: string;
    hangId?: string;
    hangActivity?: string;
  }>();
  // Each account/creation context owns its drafts and in-flight callbacks.
  return (
    <CreatePickForm
      key={JSON.stringify([session?.user.id, params.groupId, params.hangId])}
      {...params}
      viewerId={session?.user.id}
    />
  );
}
function CreatePickForm({
  viewerId,
  groupId,
  groupName,
  hangId,
  hangActivity,
}: {
  groupId?: string;
  groupName?: string;
  hangId?: string;
  hangActivity?: string;
  viewerId?: string;
}) {
  const [whenInitial, setWhenInitial] = useState<string | null>(null);
  const [proposedAt, setProposedAt] = useState<string | null>(null);
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

  const [editor, setEditor] = useState<
    'when' | 'location' | 'filters' | 'pool' | 'deadline' | 'threshold' | null
  >(null);
  const [filterDraft, setFilterDraft] = useState({ priceMax, openNow });
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const sending = useRef(false);
  const form = useRef<FormScrollView>(null);
  const attempt = useRef(0);
  const [reveal, setReveal] = useState<{ field: CreatePickField | 'submit'; id: number } | null>(
    null,
  );
  const publicPlaces = category !== 'custom' || mix !== 'none' || includeSaved;
  const priceSummary = priceMax < 0 ? 'Any price' : priceMax === 0 ? 'Free' : '$'.repeat(priceMax);
  const filterSummary = `${priceSummary}${openNow ? ' · Open now' : ''}`;
  const participantSummary = hangId
    ? 'The Pick is for the people who are down.'
    : groupId
      ? `Everyone in ${groupName ?? 'the group'} is added as soon as you create it.`
      : 'Invite friends after creating your Pick.';
  const openEditor = (next: NonNullable<typeof editor>) => {
    if (sending.current) return;
    Keyboard.dismiss();
    if (next === 'when')
      setWhenInitial(proposedAt ?? new Date(Date.now() + 3 * 3600000).toISOString());
    if (next === 'filters') setFilterDraft({ priceMax, openNow });
    setEditor(next);
  };
  const closeEditor = () => {
    Keyboard.dismiss();
    setEditor(null);
  };
  const errorFor = (field: CreatePickField, label: string) =>
    problems[field] ? (
      <Problem
        message={problems[field]!}
        label={label}
        form={form}
        revealId={reveal?.field === field ? reveal.id : undefined}
      />
    ) : null;

  const submit = async () => {
    if (sending.current || !active.current) return;
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
      deadlineAt: proposedAt
        ? null
        : deadlineMin
          ? new Date(Date.now() + deadlineMin * 60_000).toISOString()
          : null,
      ...(proposedAt && !hangId ? { proposedAt, swipeDeadlineMinutes: deadlineMin } : {}),
      closeThreshold,
    };
    const found = validateCreatePick(input);
    setProblems(Object.fromEntries(found.map((p) => [p.field, p.message])));
    if (found.length > 0) {
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
      if (input.proposedAt && !viewerId)
        throw new Error('Sign in again before creating this availability Pick.');
      if (hangId) {
        const result = await api.hangPick(hangId, input);
        if (!active.current) return;
        haptic.success();
        if (result.isParticipant)
          router.replace({ pathname: '/pick/[id]/lobby', params: { id: result.pickId } });
        else setCreatedForOthers(true);
        return;
      }
      const { pickId } = groupId
        ? input.proposedAt
          ? await api.createGroupPick(input, groupId, viewerId)
          : await api.createGroupPick(input, groupId)
        : input.proposedAt
          ? await api.createPick(input, viewerId)
          : await api.createPick(input);
      if (!active.current) return;
      haptic.success();
      // Straight to the Lobby, replacing this form so Back goes to Picks.
      router.replace({ pathname: '/pick/[id]/lobby', params: { id: pickId } });
    } catch (e) {
      if (!active.current) return;
      setSubmitError(messageOf(e));
      setReveal({ field: 'submit', id });
    } finally {
      sending.current = false;
      if (active.current) setSubmitting(false);
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
          <CategoryCards value={category} onChange={setCategory} disabled={submitting} />
        </Section>
        {category === 'custom' ? (
          <Section
            title="Your options"
            hint="Add 2–20 ideas. Everyone swipes and votes as usual."
            error={problems.customOptions}
            revealId={reveal?.field === 'customOptions' ? reveal.id : undefined}
            form={form}
          >
            <View
              style={{ gap: space.md }}
              pointerEvents={submitting ? 'none' : 'auto'}
              accessibilityElementsHidden={submitting}
            >
              <CustomPlanEditor
                options={customOptions}
                onChange={(options) => {
                  if (!sending.current) setCustomOptions(options);
                }}
              />
              <Chips
                options={[
                  { value: 'none', label: 'Only my ideas' },
                  { value: 'food', label: 'Add nearby food' },
                  { value: 'activities', label: 'Add nearby activities' },
                ]}
                value={mix}
                onChange={(value) => {
                  if (!sending.current) setMix(value);
                }}
                accessibilityLabel="Mix nearby places"
              />
            </View>
          </Section>
        ) : null}
        <Section title="Plan Details">
          <SettingsGroup>
            {!hangId ? (
              <SettingRow
                label="When"
                value={proposedAt ? formatPlanTime(proposedAt) : 'Decide later'}
                icon="calendar-outline"
                disabled={submitting}
                onPress={() => openEditor('when')}
              />
            ) : null}
            {publicPlaces ? (
              <SettingRow
                label="Where"
                value={`${placeLabel} · ${miles} mi`}
                icon="location-outline"
                disabled={submitting}
                onPress={() => openEditor('location')}
              />
            ) : null}
            <SettingRow label="Who's joining?" value={participantSummary} icon="people-outline" />
          </SettingsGroup>
          {proposedAt ? (
            <Text style={styles.hint}>
              Friends confirm availability before swiping. The swipe deadline starts when the host
              begins.
            </Text>
          ) : null}
          {errorFor('proposedAt', 'When')}
          {errorFor('swipeDeadlineMinutes', 'Swipe deadline')}
          {errorFor('center', 'Where')}
          {errorFor('radiusM', 'How far')}
        </Section>
        <Section title="Pick Settings">
          <SettingsGroup>
            <SettingSwitch
              label={hangId ? 'Include the host’s saved places' : 'Include my saved places'}
              accessibilityLabel={
                hangId
                  ? 'Include the Pick host’s saved places inside the radius'
                  : 'Include my saved places inside the radius'
              }
              value={includeSaved}
              onChange={setIncludeSaved}
              disabled={submitting}
            />
            {groupId && !hangId ? (
              <SettingSwitch
                label="Include Group Ideas"
                value={includeGroupIdeas}
                onChange={setIncludeGroupIdeas}
                disabled={submitting}
                hint="Mix in matching ideas from this group. Distance, price and Open Now apply to public places only."
              />
            ) : null}
            {publicPlaces ? (
              <SettingRow
                label="Place filters"
                value={filterSummary}
                icon="options-outline"
                disabled={submitting}
                onPress={() => openEditor('filters')}
              />
            ) : null}
            {category !== 'custom' ? (
              <SettingRow
                label="Number of places"
                value={`${poolSize}`}
                icon="layers-outline"
                disabled={submitting}
                onPress={() => openEditor('pool')}
              />
            ) : null}
            <SettingRow
              label="Swipe deadline"
              value={DEADLINES.find((d) => d.value === deadlineMin)?.label ?? `${deadlineMin} min`}
              icon="time-outline"
              disabled={submitting}
              onPress={() => openEditor('deadline')}
            />
            <SettingRow
              label="Close early"
              value={
                closeThreshold === 100
                  ? 'Everyone finishes swiping'
                  : `${closeThreshold}% finish swiping`
              }
              icon="checkmark-done-outline"
              disabled={submitting}
              onPress={() => openEditor('threshold')}
            />
          </SettingsGroup>
          {errorFor('includeGroupIdeas', 'Group Ideas')}
          {errorFor('priceMax', 'Place filters')}
          {errorFor('poolSize', 'How many places')}
          {errorFor('deadlineAt', 'Swiping deadline')}
          {errorFor('closeThreshold', 'Close early when')}
        </Section>
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
      {editor === 'when' ? (
        <PlanTimeSheet
          initial={whenInitial}
          onClose={closeEditor}
          onDecideLater={() => {
            setProposedAt(null);
            closeEditor();
          }}
          onSave={async (value) => {
            setProposedAt(value);
          }}
        />
      ) : null}
      {editor === 'location' ? (
        <NewPickLocationEditor
          initial={{ center, label: placeLabel, miles }}
          onCancel={closeEditor}
          onApply={(next) => {
            setCenter(next.center);
            setPlaceLabel(next.label);
            setMiles(next.miles);
            setProblems((p) => ({ ...p, center: undefined, radiusM: undefined }));
            closeEditor();
          }}
        />
      ) : null}
      {editor && editor !== 'location' && editor !== 'when' ? (
        <Sheet
          visible
          title={
            editor === 'filters'
              ? 'Place filters'
              : editor === 'pool'
                ? 'Number of places'
                : editor === 'deadline'
                  ? 'Swipe deadline'
                  : 'Close early'
          }
          onClose={closeEditor}
          closeAccessibilityLabel="Cancel settings"
          footer={
            editor === 'filters' ? (
              <Button
                label="Apply filters"
                onPress={() => {
                  setPriceMax(filterDraft.priceMax);
                  setOpenNow(filterDraft.openNow);
                  closeEditor();
                }}
              />
            ) : undefined
          }
        >
          {editor === 'filters' ? (
            <>
              <Text style={styles.hint}>
                Unknown prices or hours are excluded when that filter is on.
              </Text>
              <PlaceFilterControls
                priceMax={filterDraft.priceMax}
                openNow={filterDraft.openNow}
                onPrice={(priceMax) => setFilterDraft((d) => ({ ...d, priceMax }))}
                onOpen={(openNow) => setFilterDraft((d) => ({ ...d, openNow }))}
              />
            </>
          ) : editor === 'pool' ? (
            <>
              <Text style={styles.hint}>
                Fewer places make swiping faster; more give everyone extra options.
              </Text>
              <ChoiceList
                options={POOL_SIZES}
                value={poolSize}
                accessibilityLabel="Pool size"
                onChange={(value) => {
                  setPoolSize(value);
                  closeEditor();
                }}
              />
            </>
          ) : editor === 'deadline' ? (
            <>
              <Text style={styles.hint}>
                When swiping closes, not when you’re going out. Scheduled Picks start this clock
                when the host starts swiping; other Picks start it at creation.
              </Text>
              <ChoiceList
                options={DEADLINES}
                value={deadlineMin}
                accessibilityLabel="Deadline"
                onChange={(value) => {
                  setDeadlineMin(value);
                  closeEditor();
                }}
              />
            </>
          ) : (
            <>
              <Text style={styles.hint}>
                The Pick can advance once this many people finish swiping. The server enforces
                participant requirements.
              </Text>
              <ChoiceList
                options={THRESHOLDS}
                value={closeThreshold}
                accessibilityLabel="Close threshold"
                onChange={(value) => {
                  setCloseThreshold(value);
                  closeEditor();
                }}
              />
            </>
          )}
        </Sheet>
      ) : null}
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
  error: { ...type.caption, color: colors.danger },
});
