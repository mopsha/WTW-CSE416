import { useReducedMotion } from 'react-native-reanimated';
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
import type { GroupSummary } from '@/lib/groups';
import {
  changeHangDate,
  hangPlanInput,
  hangTimeProblem,
  HANG_START_HORIZON_MS,
} from '@/lib/hangPlan';
import { queries } from '@/lib/queries';
import { Button, ErrorState, IconButton, Screen } from './index';
import { Sheet } from './TabUi';
import { colors, MIN_TARGET, picksTheme, radius, space } from './theme';

const ACTIVITIES = [
  'Game night',
  'Basketball',
  'Cookout',
  'Study session',
  'House party',
  'Movie night',
  'Other',
];
type Picker = 'date' | 'time';

export function HangPlanComposer({ onClose, onCreated }: { onClose(): void; onCreated(): void }) {
  const reduceMotion = useReducedMotion();
  const userId = useAuth().session?.user.id;
  const [activity, setActivity] = useState('');
  const [custom, setCustom] = useState('');
  const [start, setStart] = useState(
    () => new Date(Math.ceil((Date.now() + 3600000) / 60000) * 60000),
  );
  const [now, setNow] = useState(Date.now);
  const [audience, setAudience] = useState('all_friends');
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [groupState, setGroupState] = useState<{ loading: boolean; error?: string }>({
    loading: !!userId,
  });
  const [retry, setRetry] = useState(0);
  const [selection, setSelection] = useState<'activity' | 'audience' | null>(null);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const pending = useRef(false);
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
      void queries
        .listMyGroups(userId)
        .then((value) => {
          if (active) {
            setGroups(value);
            setGroupState({ loading: false });
          }
        })
        .catch((e) => {
          if (active)
            setGroupState({ loading: false, error: `Could not load groups: ${messageOf(e)}` });
        });
    return () => {
      active = false;
    };
  }, [userId, retry]);

  const title = activity === 'Other' ? custom : activity;
  const timeProblem = hangTimeProblem(start, now);
  const selectedGroup = groups.find((g) => g.id === audience);
  const valid =
    !!title.trim() &&
    title.trim().length <= 60 &&
    !timeProblem &&
    (audience === 'all_friends' || !!selectedGroup);
  function openSelection(value: 'activity' | 'audience') {
    if (pending.current) return;
    Keyboard.dismiss();
    setPicker(null);
    setSelection(value);
  }
  function openPicker(mode: Picker) {
    if (pending.current) return;
    Keyboard.dismiss();
    setError(null);
    setNow(Date.now());
    if (Platform.OS === 'android') {
      androidPicker.current = mode;
      DateTimePickerAndroid.open({
        value: start,
        mode,
        display: 'default',
        ...(mode === 'date'
          ? { minimumDate: new Date(), maximumDate: new Date(Date.now() + HANG_START_HORIZON_MS) }
          : {}),
        onValueChange: (_, date) => {
          androidPicker.current = null;
          if (mounted.current) setStart(changeHangDate(start, date, mode));
        },
        onDismiss: () => {
          androidPicker.current = null;
        },
        onError: () => {
          androidPicker.current = null;
          if (mounted.current) setError('Could not open the date picker. Try again.');
        },
      });
    } else if (Platform.OS === 'ios') setPicker((current) => (current === mode ? null : mode));
    else setError('Choose a date and time in the iOS or Android app.');
  }
  async function submit() {
    if (pending.current || !userId) return;
    setError(null);
    let input;
    try {
      input = hangPlanInput(title, start, audience);
      if (audience !== 'all_friends' && !selectedGroup)
        throw new Error('Choose an available group.');
    } catch (e) {
      setError(messageOf(e));
      return;
    }
    pending.current = true;
    setBusy(true);
    Keyboard.dismiss();
    setPicker(null);
    try {
      await api.createHang(input);
      if (mounted.current) onCreated();
    } catch (e) {
      if (mounted.current) setError(messageOf(e));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <Screen scroll={false} contentStyle={styles.frame}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.heading}>
          Make a hang plan
        </Text>
        <IconButton icon="close" accessibilityLabel="Close compose" onPress={onClose} />
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      >
        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.label}>
            {"What's the plan?"}
          </Text>
          <View style={styles.group}>
            <FormRow
              label="Activity"
              value={activity || 'Choose an activity'}
              onPress={() => openSelection('activity')}
              disabled={busy}
            />
            {activity === 'Other' ? (
              <TextInput
                value={custom}
                onChangeText={setCustom}
                maxLength={60}
                placeholder="What do you want to do?"
                placeholderTextColor={colors.muted}
                accessibilityLabel="Hang activity"
                editable={!busy}
                returnKeyType="done"
                onSubmitEditing={() => Keyboard.dismiss()}
                onFocus={() => {
                  setFocused(true);
                  setPicker(null);
                }}
                onBlur={() => setFocused(false)}
                style={[styles.input, focused && styles.inputFocused]}
              />
            ) : null}
          </View>
        </View>
        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.label}>
            When?
          </Text>
          <View style={styles.group}>
            <FormRow
              label="Date"
              value={start.toLocaleDateString(undefined, {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
              onPress={() => openPicker('date')}
              disabled={busy}
              expanded={picker === 'date'}
            />
            <View style={styles.separator} />
            <FormRow
              label="Time"
              value={start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
              onPress={() => openPicker('time')}
              disabled={busy}
              expanded={picker === 'time'}
            />
          </View>
          {picker && Platform.OS === 'ios' ? (
            <View style={styles.group}>
              <View style={styles.pickerHead}>
                <Text style={styles.secondary}>{picker === 'date' ? 'Date' : 'Time'}</Text>
                <Pressable
                  onPress={() => setPicker(null)}
                  accessibilityRole="button"
                  accessibilityLabel="Done choosing date and time"
                  style={styles.done}
                >
                  <Text style={styles.accent}>Done</Text>
                </Pressable>
              </View>
              <DateTimePicker
                key={picker}
                value={start}
                mode={picker}
                display="spinner"
                themeVariant="dark"
                textColor={colors.text}
                accentColor={colors.primary}
                minimumDate={picker === 'date' ? new Date(now) : undefined}
                maximumDate={picker === 'date' ? new Date(now + HANG_START_HORIZON_MS) : undefined}
                onValueChange={(_, date) =>
                  setStart((current) => changeHangDate(current, date, picker))
                }
                accessibilityLabel={`Hang ${picker}`}
                style={styles.wheel}
              />
            </View>
          ) : null}
          <Text style={styles.note}>Responses stay open until four hours after the start.</Text>
          {timeProblem ? (
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
              value={
                audience === 'all_friends'
                  ? 'All friends'
                  : (selectedGroup?.name ?? 'Choose a group')
              }
              onPress={() => openSelection('audience')}
              disabled={busy}
            />
          </View>
          {groupState.loading ? (
            <Text accessibilityLiveRegion="polite" style={styles.note}>
              Loading groups…
            </Text>
          ) : null}
          {groupState.error ? (
            <ErrorState
              message={groupState.error}
              onRetry={() => {
                setGroupState({ loading: true });
                setRetry((n) => n + 1);
              }}
            />
          ) : null}
        </View>
        {error ? <ErrorState message={error} /> : null}
      </ScrollView>
      <View style={styles.footer}>
        <Button
          label="Save hang plan"
          disabled={!valid || busy || !userId}
          loading={busy}
          onPress={() => void submit()}
        />
      </View>
      <Sheet
        animationType={reduceMotion ? 'none' : 'slide'}
        visible={selection !== null}
        title={selection === 'activity' ? "What's the plan?" : 'Who?'}
        onClose={() => setSelection(null)}
      >
        {(selection === 'activity'
          ? ACTIVITIES.map((value) => ({ value, label: value }))
          : [
              { value: 'all_friends', label: 'All friends' },
              ...groups.map((g) => ({ value: g.id, label: g.name })),
            ]
        ).map((item) => {
          const selected = item.value === (selection === 'activity' ? activity : audience);
          return (
            <Pressable
              key={item.value}
              accessibilityRole="radio"
              accessibilityLabel={item.label}
              accessibilityState={{ checked: selected }}
              onPress={() => {
                if (selection === 'activity') setActivity(item.value);
                else setAudience(item.value);
                setSelection(null);
              }}
              style={({ pressed }) => [styles.option, pressed && styles.pressed]}
            >
              <Text style={[styles.value, selected && styles.accent]}>{item.label}</Text>
              {selected ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}
            </Pressable>
          );
        })}
        {selection === 'audience' && groupState.loading ? (
          <Text accessibilityLiveRegion="polite" style={styles.note}>
            Loading groups…
          </Text>
        ) : null}
        {selection === 'audience' && groupState.error ? (
          <ErrorState
            message={groupState.error}
            onRetry={() => {
              setGroupState({ loading: true });
              setRetry((n) => n + 1);
            }}
          />
        ) : null}
        {selection === 'audience' && !groupState.loading && !groups.length && !groupState.error ? (
          <Text style={styles.note}>No groups yet. You can share with all friends.</Text>
        ) : null}
      </Sheet>
    </Screen>
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
  heading: { ...picksTheme.section, color: colors.text, flex: 1 },
  scroll: { flex: 1 },
  body: { padding: space.xl, gap: space.xl },
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
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginLeft: space.md,
  },
  input: {
    ...picksTheme.ui,
    color: colors.text,
    minHeight: MIN_TARGET + space.md,
    padding: space.md,
    borderTopWidth: 1,
    borderColor: colors.border,
    borderBottomLeftRadius: radius.md,
    borderBottomRightRadius: radius.md,
  },
  inputFocused: { borderColor: colors.primary },
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
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
