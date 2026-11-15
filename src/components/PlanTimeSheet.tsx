import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useEffect, useRef, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { changePlanDate, formatPlanTime, planTimeOptions, planTimeProblem } from '@/lib/plans';
import { messageOf } from '@/lib/errors';
import { Button } from './Button';
import { ErrorBanner } from './ErrorBanner';
import { Sheet } from './TabUi';
import { colors, space, type } from './theme';

/** Mounted afresh for each edit, so cancel discards the draft. */
export function PlanTimeSheet({
  initial,
  onClose,
  onSave,
}: {
  initial: string | null;
  onClose(): void;
  onSave(value: string): Promise<void>;
}) {
  const [draft, setDraft] = useState(() =>
    initial ? new Date(initial) : new Date(Date.now() + 3600_000),
  );
  const [picker, setPicker] = useState<'date' | 'time' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  const android = useRef<'date' | 'time' | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    mounted.current = true;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      if (android.current) void DateTimePickerAndroid.dismiss(android.current);
    };
  }, []);
  const problem = planTimeProblem(draft, now);
  function open(mode: 'date' | 'time') {
    if (pending.current || android.current) return;
    if (Platform.OS === 'android') {
      android.current = mode;
      DateTimePickerAndroid.open({
        value: draft,
        mode,
        display: 'default',
        ...(mode === 'date'
          ? { minimumDate: new Date(), maximumDate: new Date(Date.now() + 30 * 86400_000) }
          : {}),
        onValueChange: (_, date) => {
          android.current = null;
          if (mounted.current) setDraft((current) => changePlanDate(current, date, mode));
        },
        onDismiss: () => {
          android.current = null;
        },
        onError: () => {
          android.current = null;
          if (mounted.current) setError('Could not open the picker. Try again.');
        },
      });
    } else if (Platform.OS === 'ios') setPicker(mode);
    else setError('Custom date and time selection is available in the iOS and Android apps.');
  }
  async function save() {
    if (pending.current) return;
    const invalid = planTimeProblem(draft);
    if (invalid) {
      setError(invalid);
      return;
    }
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await onSave(draft.toISOString());
      if (mounted.current) onClose();
    } catch (e) {
      if (mounted.current) setError(messageOf(e));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <Sheet
      visible
      title="Set a time"
      onClose={() => {
        if (!pending.current) onClose();
      }}
    >
      <Text style={{ ...type.body, color: colors.text }}>
        {formatPlanTime(draft.toISOString())}
      </Text>
      <Text style={{ ...type.caption, color: colors.muted }}>
        Times are in your device’s local timezone.
      </Text>
      <View style={{ gap: space.sm }}>
        {planTimeOptions(new Date(now)).map((option) => (
          <Button
            key={option.label}
            label={option.label}
            variant="secondary"
            disabled={busy}
            onPress={() => {
              setDraft(new Date(option.value));
              setError(null);
            }}
          />
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        <Button
          label="Choose date"
          variant="secondary"
          disabled={busy}
          onPress={() => open('date')}
        />
        <Button
          label="Choose time"
          variant="secondary"
          disabled={busy}
          onPress={() => open('time')}
        />
      </View>
      {Platform.OS === 'ios' && picker ? (
        <DateTimePicker
          key={picker}
          value={draft}
          mode={picker}
          display={picker === 'time' ? 'spinner' : 'inline'}
          themeVariant="dark"
          textColor={colors.text}
          accentColor={colors.primary}
          disabled={busy}
          minimumDate={picker === 'date' ? new Date(now) : undefined}
          maximumDate={picker === 'date' ? new Date(now + 30 * 86400_000) : undefined}
          onValueChange={(_, date) => setDraft((current) => changePlanDate(current, date, picker))}
          accessibilityLabel={`Plan ${picker}`}
        />
      ) : null}
      {error || problem ? <ErrorBanner message={error ?? problem!} /> : null}
      <Button
        label="Save time"
        disabled={busy || !!problem}
        loading={busy}
        onPress={() => void save()}
      />
      <Button label="Cancel" variant="link" disabled={busy} onPress={onClose} />
    </Sheet>
  );
}
