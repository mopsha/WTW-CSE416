import { useMotionPreference } from '@/hooks/useMotionPreference';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { messageOf } from '@/lib/errors';
import { memberName, type FriendOption, type GroupSummary } from '@/lib/groups';
import {
  changeHangDate,
  hangPlanInput,
  hangTimeProblem,
  HANG_START_HORIZON_MS,
  hangPreview,
  hangTimeLabel,
  resolveHangTime,
  type HangQuickTime,
} from '@/lib/hangPlan';
import type { HangInput, HangPost } from '@shared/api/hang.ts';
import { textFilter } from '@shared/domain/textFilter.ts';
import { queries } from '@/lib/queries';
import { Button, ErrorState, Screen } from './index';
import { Sheet } from './TabUi';
import { colors, MIN_TARGET, picksTheme, radius, space } from './theme';

const ACTIVITIES = ['Volleyball', 'Food', 'Basketball', 'Movie', 'Study', 'Something else'];
const TIMES = [
  { id: 'now', label: 'Right now' },
  { id: 'tonight', label: 'Tonight' },
  { id: 'tomorrow', label: 'Tomorrow' },
  { id: 'custom', label: 'Pick time' },
] as const;

export interface HangSendRecovery {
  key: string;
  input: HangInput;
}

type Picker = 'date' | 'time';

export function HangPlanComposer({
  onClose,
  onCreated,
  onSavingChange,
  recovery,
  onRecoveryChange,
}: {
  onClose(): void;
  onCreated(post: HangPost): void;
  onSavingChange?(saving: boolean): void;
  recovery?: HangSendRecovery | null;
  onRecoveryChange?(recovery: HangSendRecovery | null): void;
}) {
  const reduceMotion = useMotionPreference();
  const userId = useAuth().session?.user.id;
  const [activity, setActivity] = useState(recovery?.input.activity ?? '');
  const [choice, setChoice] = useState<HangQuickTime>(
    recovery && !recovery.input.startNow ? 'custom' : 'now',
  );
  const [start, setStart] = useState(() =>
    recovery ? new Date(recovery.input.startsAt) : resolveHangTime('now'),
  );
  const [now, setNow] = useState(Date.now);
  const [allFriends, setAllFriends] = useState(recovery?.input.audience === 'all_friends');
  const [groupIds, setGroupIds] = useState<string[]>(recovery?.input.groupIds ?? []);
  const [friendIds, setFriendIds] = useState<string[]>(recovery?.input.friendIds ?? []);
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [friends, setFriends] = useState<FriendOption[]>([]);
  const [audienceState, setAudienceState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [retry, setRetry] = useState(0);
  const [audienceOpen, setAudienceOpen] = useState(false);
  const [picker, setPicker] = useState<{ mode: Picker; date: Date } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const [uncertain, setUncertain] = useState(recovery ?? null);
  const mounted = useRef(true);
  const androidPicker = useRef<Picker | null>(null);
  useEffect(() => {
    mounted.current = true;
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      if (Platform.OS === 'android' && androidPicker.current)
        void DateTimePickerAndroid.dismiss(androidPicker.current);
    };
  }, []);
  useEffect(() => {
    let active = true;
    if (userId)
      void Promise.allSettled([queries.listMyGroups(userId, true), api.listFriends(userId)]).then(
        ([groupResult, friendResult]) => {
          if (!active) return;
          if (groupResult.status === 'fulfilled') setGroups(groupResult.value);
          if (friendResult.status === 'fulfilled') setFriends(friendResult.value.friends);
          setAudienceState(
            groupResult.status === 'fulfilled' && friendResult.status === 'fulfilled'
              ? 'ready'
              : 'error',
          );
        },
      );
    return () => {
      active = false;
    };
  }, [userId, retry]);

  const timeProblem = choice === 'now' ? null : hangTimeProblem(start, now);
  const timeLabel = choice === 'now' ? 'Right now' : hangTimeLabel(start);
  const audienceNames = [
    ...groups.filter((group) => groupIds.includes(group.id)).map((group) => group.name),
    ...friends.filter((friend) => friendIds.includes(friend.userId)).map(memberName),
  ];
  const audienceSummary = allFriends
    ? 'All friends'
    : audienceNames.length
      ? audienceNames.slice(0, 2).join(', ') +
        (audienceNames.length > 2 ? ` +${audienceNames.length - 2}` : '')
      : 'Choose people';
  const allFriendsAvailable = audienceState !== 'ready' || friends.length > 0;
  const hasAudience = allFriends ? allFriendsAvailable : groupIds.length + friendIds.length > 0;
  const key = JSON.stringify([
    activity.trim(),
    choice === 'now' ? null : start,
    allFriends,
    [...groupIds].sort(),
    [...friendIds].sort(),
  ]);
  const replay = uncertain?.key === key ? uncertain.input : null;
  const activityAllowed = textFilter(activity).ok;
  const valid =
    !!replay ||
    (!!activity.trim() &&
      activity.trim().length <= 60 &&
      activityAllowed &&
      !timeProblem &&
      hasAudience);

  function toggleAudience(kind: 'all' | 'group' | 'friend', id: string) {
    const toggle = (items: string[]) =>
      items.includes(id) ? items.filter((item) => item !== id) : [...items, id];
    if (kind === 'all') {
      setAllFriends(!allFriends);
      setGroupIds([]);
      setFriendIds([]);
    } else {
      setAllFriends(false);
      if (kind === 'group') setGroupIds(toggle);
      else setFriendIds(toggle);
    }
  }

  function selectTime(value: HangQuickTime) {
    setChoice(value);
    const selectedAt = resolveHangTime('now').getTime();
    setStart(resolveHangTime(value, selectedAt));
    setNow(selectedAt);
    setPicker(null);
    setError(null);
    Keyboard.dismiss();
  }

  function openPicker(mode: Picker) {
    if (pending.current) return;
    Keyboard.dismiss();
    setError(null);
    const openedAt = resolveHangTime('now').getTime();
    const value =
      picker?.date ??
      (choice === 'now' || hangTimeProblem(start, openedAt)
        ? resolveHangTime('custom', openedAt)
        : start);
    setNow(openedAt);
    if (Platform.OS === 'android') {
      androidPicker.current = mode;
      DateTimePickerAndroid.open({
        value,
        mode,
        display: 'default',
        ...(mode === 'date'
          ? {
              minimumDate: new Date(Math.floor(openedAt / 60000) * 60000 + 60000),
              maximumDate: new Date(openedAt + HANG_START_HORIZON_MS),
            }
          : {}),
        onValueChange: (_, date) => {
          androidPicker.current = null;
          if (mounted.current) {
            setStart(changeHangDate(value, date, mode, Date.now()));
            setChoice('custom');
          }
        },
        onDismiss: () => {
          androidPicker.current = null;
        },
        onError: () => {
          androidPicker.current = null;
          if (mounted.current) setError('Could not open the date picker. Try again.');
        },
      });
    } else if (Platform.OS === 'ios') setPicker({ mode, date: value });
    else setError('Choose a date and time in the iOS or Android app.');
  }
  async function submit() {
    if (pending.current || !userId || picker) return;
    setError(null);
    let input: HangInput;
    try {
      if (!replay && !hasAudience) throw new Error('Choose people to invite.');
      input =
        replay ??
        hangPlanInput(
          activity,
          start,
          { allFriends, groupIds, friendIds },
          Date.now(),
          choice === 'now',
        );
    } catch (e) {
      setError(messageOf(e));
      return;
    }
    pending.current = true;
    onSavingChange?.(true);
    setBusy(true);
    Keyboard.dismiss();
    setPicker(null);
    try {
      const post = await api.createHang(input, userId);
      if (mounted.current) {
        if (!post?.id) throw new Error('Could not confirm the Hang was sent.');
        onRecoveryChange?.(null);
        setUncertain(null);
        onCreated(post);
      }
    } catch (e) {
      if (mounted.current) {
        const status = (e as { status?: number } | null)?.status;
        if (status === undefined || status === 0 || status === 408 || status >= 500) {
          const request = { key, input };
          setUncertain(request);
          onRecoveryChange?.(request);
        } else if (replay) {
          setUncertain(null);
          onRecoveryChange?.(null);
        }
        setError(messageOf(e));
      }
    } finally {
      pending.current = false;
      if (mounted.current) {
        onSavingChange?.(false);
        setBusy(false);
      }
    }
  }
  return (
    <Screen scroll={false} contentStyle={styles.frame}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.heading}>
          Make a hang plan
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close compose"
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={() => {
            if (!pending.current) onClose();
          }}
          style={[styles.close, busy && styles.disabled]}
        >
          <Ionicons name="close" size={22} color={colors.text} />
        </Pressable>
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      >
        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.label}>
            What’s the move?
          </Text>
          <TextInput
            value={activity}
            onChangeText={setActivity}
            maxLength={60}
            placeholder="Basketball, food, movies, anything..."
            placeholderTextColor={colors.muted}
            accessibilityLabel="Hang activity"
            editable={!busy}
            returnKeyType="done"
            onFocus={() => setPicker(null)}
            style={styles.input}
          />
          {!activityAllowed ? (
            <Text style={styles.validation}>Try different words for your activity.</Text>
          ) : null}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.chips}
          >
            {ACTIVITIES.map((suggestion) => (
              <Chip
                key={suggestion}
                label={suggestion}
                selected={activity === suggestion}
                disabled={busy}
                onPress={() => setActivity(suggestion)}
              />
            ))}
          </ScrollView>
        </View>
        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.label}>
            When?
          </Text>
          <View style={styles.times}>
            {TIMES.map(({ id, label }) => (
              <Chip
                key={id}
                label={label}
                selected={choice === id}
                disabled={busy || (id === 'tonight' && resolveHangTime(id, now).getTime() <= now)}
                onPress={() => (id === 'custom' ? openPicker('date') : selectTime(id))}
              />
            ))}
          </View>
          {choice !== 'now' || picker ? (
            <View style={styles.group}>
              <FormRow
                label="Date"
                value={(picker?.date ?? start).toLocaleDateString()}
                onPress={() => openPicker('date')}
                disabled={busy}
                expanded={picker?.mode === 'date'}
              />
              <FormRow
                label="Time"
                value={(picker?.date ?? start).toLocaleTimeString(undefined, {
                  hour: 'numeric',
                  minute: '2-digit',
                })}
                onPress={() => openPicker('time')}
                disabled={busy}
                expanded={picker?.mode === 'time'}
              />
            </View>
          ) : null}
          {picker && Platform.OS === 'ios' ? (
            <View style={styles.group}>
              <View style={styles.pickerHead}>
                <Text style={styles.secondary}>{picker.mode === 'date' ? 'Date' : 'Time'}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cancel choosing date and time"
                  onPress={() => setPicker(null)}
                  style={styles.done}
                >
                  <Text style={styles.secondary}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setStart(picker.date);
                    setChoice('custom');
                    setPicker(null);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Done choosing date and time"
                  style={styles.done}
                >
                  <Text style={styles.accent}>Done</Text>
                </Pressable>
              </View>
              <DateTimePicker
                key={picker.mode}
                value={picker.date}
                mode={picker.mode}
                display="spinner"
                themeVariant="dark"
                textColor={colors.text}
                accentColor={colors.primary}
                minimumDate={
                  picker.mode === 'date'
                    ? new Date(Math.floor(now / 60000) * 60000 + 60000)
                    : undefined
                }
                maximumDate={
                  picker.mode === 'date' ? new Date(now + HANG_START_HORIZON_MS) : undefined
                }
                onValueChange={(_, date) =>
                  setPicker(
                    (current) =>
                      current && {
                        ...current,
                        date: changeHangDate(current.date, date, current.mode, Date.now()),
                      },
                  )
                }
                accessibilityLabel={`Hang ${picker.mode}`}
                style={styles.wheel}
              />
            </View>
          ) : null}
          {timeProblem && !replay ? (
            <Text accessibilityLiveRegion="polite" style={styles.validation}>
              {timeProblem}
            </Text>
          ) : null}
        </View>
        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.label}>
            Who?
          </Text>
          <View style={styles.group}>
            <FormRow
              label="Audience"
              value={audienceSummary}
              disabled={busy}
              onPress={() => {
                Keyboard.dismiss();
                setPicker(null);
                setAudienceOpen(true);
              }}
            />
          </View>
        </View>
        {error ? <ErrorState message={error} /> : null}
        {replay ? (
          <Text style={styles.note}>Send again to check whether this Hang was posted.</Text>
        ) : null}
      </ScrollView>
      <View style={styles.footer}>
        {activity.trim() ? (
          <Text style={styles.preview}>{hangPreview(activity, timeLabel)}</Text>
        ) : null}
        <Button
          label="Send hang"
          disabled={!valid || busy || !userId || !!picker}
          loading={busy}
          onPress={() => void submit()}
        />
      </View>
      <Sheet
        animationType={reduceMotion ? 'none' : 'slide'}
        visible={audienceOpen}
        title="Who’s coming?"
        onClose={() => setAudienceOpen(false)}
      >
        <AudienceOption
          label="All friends"
          selected={allFriends}
          disabled={!allFriendsAvailable}
          onPress={() => toggleAudience('all', '')}
        />
        {groups.length ? (
          <Text accessibilityRole="header" style={styles.label}>
            Groups
          </Text>
        ) : null}
        {groups.map((group) => (
          <AudienceOption
            key={group.id}
            label={group.name}
            selected={groupIds.includes(group.id)}
            onPress={() => toggleAudience('group', group.id)}
          />
        ))}
        {audienceState === 'ready' && !friends.length ? (
          <Text style={styles.note}>No friends to invite yet.</Text>
        ) : null}
        {friends.length ? (
          <Text accessibilityRole="header" style={styles.label}>
            Friends
          </Text>
        ) : null}
        {friends.map((friend) => (
          <AudienceOption
            key={friend.userId}
            label={memberName(friend)}
            selected={friendIds.includes(friend.userId)}
            onPress={() => toggleAudience('friend', friend.userId)}
          />
        ))}
        {audienceState === 'loading' ? <Text style={styles.note}>Loading people…</Text> : null}
        {audienceState === 'error' ? (
          <ErrorState
            message="Some people couldn’t load."
            onRetry={() => {
              setAudienceState('loading');
              setRetry((n) => n + 1);
            }}
          />
        ) : null}
        <Button
          variant="secondary"
          label="Done choosing people"
          onPress={() => setAudienceOpen(false)}
        />
      </Sheet>
    </Screen>
  );
}
function Chip({
  label,
  selected,
  disabled,
  onPress,
}: {
  label: string;
  selected: boolean;
  disabled: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipSelected,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.secondary, selected && styles.accent]}>{label}</Text>
    </Pressable>
  );
}

function AudienceOption({
  label,
  selected,
  disabled = false,
  onPress,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.value, selected && styles.accent]}>{label}</Text>
      <Ionicons
        name={selected ? 'checkbox' : 'square-outline'}
        size={20}
        color={selected ? colors.primary : colors.muted}
      />
    </Pressable>
  );
}

function FormRow({
  label,
  value,
  onPress,
  disabled,
  expanded,
}: {
  label: string;
  value: string;
  onPress(): void;
  disabled: boolean;
  expanded?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${value}`}
      accessibilityState={{ disabled, ...(expanded === undefined ? {} : { expanded }) }}
      style={({ pressed }) => [styles.row, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowValue}>
        <Text style={styles.value}>{value}</Text>
        <Ionicons name="chevron-forward" color={colors.muted} size={16} />
      </View>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  frame: { padding: 0, gap: 0 },
  header: {
    paddingHorizontal: space.xl,
    paddingVertical: space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  close: {
    width: MIN_TARGET,
    height: MIN_TARGET,
    borderRadius: MIN_TARGET / 2,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heading: { ...picksTheme.section, color: colors.text, flex: 1 },
  scroll: { flex: 1 },
  body: { padding: space.lg, gap: space.lg },
  chips: { gap: space.sm },
  times: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    minHeight: MIN_TARGET,
    minWidth: MIN_TARGET,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSelected: { borderColor: colors.primary },
  preview: { ...picksTheme.secondary, color: colors.text },
  section: { gap: space.sm },
  label: { ...picksTheme.secondary, color: colors.muted, paddingHorizontal: space.md },
  group: { backgroundColor: colors.card, borderRadius: radius.md },
  row: {
    minHeight: MIN_TARGET + space.md,
    padding: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  rowLabel: { ...picksTheme.ui, color: colors.text },
  rowValue: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: space.sm,
  },
  value: { ...picksTheme.ui, color: colors.text, flexShrink: 1 },
  secondary: { ...picksTheme.secondary, color: colors.muted },
  accent: { color: colors.primary },
  input: {
    ...picksTheme.ui,
    color: colors.text,
    minHeight: MIN_TARGET + space.md,
    padding: space.md,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pickerHead: {
    paddingLeft: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  done: {
    minHeight: MIN_TARGET,
    minWidth: MIN_TARGET,
    padding: space.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wheel: { alignSelf: 'stretch' },
  note: { ...picksTheme.secondary, color: colors.muted, paddingHorizontal: space.md },
  validation: { ...picksTheme.secondary, color: colors.danger, paddingHorizontal: space.md },
  option: {
    minHeight: MIN_TARGET + space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pressed: { backgroundColor: colors.cardHi },
  disabled: { opacity: 0.5 },
  footer: {
    padding: space.lg,
    gap: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
