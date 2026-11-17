import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import type { TimeSuggestions as SuggestionList } from '@shared/api/timeSuggestions.ts';
import { useAction } from '@/hooks/useAction';
import { usePrivateRefresh } from '@/hooks/usePrivateRefresh';
import { api } from '@/lib/api';
import { isAccessDenied, messageOf } from '@/lib/errors';
import { formatPlanTime } from '@/lib/plans';
import { Button } from './Button';
import { ErrorBanner } from './ErrorBanner';
import { PlanTimeSheet } from './PlanTimeSheet';
import { colors, space, type } from './theme';

export function TimeSuggestions({
  pickId,
  viewerId,
  planAt,
  onChanged,
}: {
  pickId: string;
  viewerId: string;
  planAt: string;
  onChanged: () => Promise<void>;
}) {
  return (
    <SuggestionsContent
      key={JSON.stringify([pickId, viewerId])}
      pickId={pickId}
      viewerId={viewerId}
      planAt={planAt}
      onChanged={onChanged}
    />
  );
}
function SuggestionsContent({
  pickId,
  viewerId,
  planAt,
  onChanged,
}: {
  pickId: string;
  viewerId: string;
  planAt: string;
  onChanged: () => Promise<void>;
}) {
  const [value, setValue] = useState<SuggestionList | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const epoch = useRef(0);
  const live = useRef(true);
  const writing = useRef(false);
  const viewing = useRef(false);
  const lastPlanAt = useRef(planAt);
  const lastRevision = useRef<number | null>(null);
  const action = useAction();
  const clear = useCallback(() => {
    epoch.current++;
    viewing.current = false;
    setValue(null);
    setEditing(false);
    setEnabled(false);
    setError(null);
  }, []);
  useEffect(() => {
    live.current = true;
    const generation = epoch.current;
    return () => {
      live.current = false;
      viewing.current = false;
      epoch.current = generation + 1;
    };
  }, []);
  const load = useCallback(async () => {
    const request = ++epoch.current;
    try {
      const capabilities = await api.getPickCapabilities(viewerId);
      if (!live.current || request !== epoch.current) return;
      if (capabilities.timeSuggestions !== true) {
        viewing.current = false;
        setError(null);
        setEnabled(false);
        setValue(null);
        setEditing(false);
        return;
      }
      const next = await api.getTimeSuggestions(pickId, viewerId);
      if (!live.current || request !== epoch.current) return;
      viewing.current = true;
      setEnabled(true);
      setError(null);
      if (lastRevision.current !== null && lastRevision.current !== next.revision)
        setEditing(false);
      lastRevision.current = next.revision;
      setValue(next);
    } catch (e) {
      if (!live.current || request !== epoch.current) return;
      if (isAccessDenied(e)) {
        setError(null);
        viewing.current = false;
        setValue(null);
        setEditing(false);
        setEnabled(false);
      } else setError(messageOf(e));
    }
  }, [pickId, viewerId]);
  usePrivateRefresh(load, clear, 30_000);
  // Direct host rescheduling invalidates any editor even before the next list poll.
  useEffect(() => {
    if (lastPlanAt.current === planAt) return;
    lastPlanAt.current = planAt;
    setEditing(false);
    void load();
  }, [planAt, load]);
  async function mutate(work: () => Promise<unknown>) {
    if (!live.current || !viewing.current)
      throw new Error('Refresh this Pick before changing the schedule.');
    if (writing.current) throw new Error('Another schedule change is saving.');
    writing.current = true;
    setSaving(true);
    const request = epoch.current;
    try {
      await work();
      if (live.current && request === epoch.current) {
        await onChanged();
        await load();
      }
    } catch (e) {
      if (live.current && request === epoch.current) {
        await onChanged().catch(() => {});
        await load();
      }
      throw e;
    } finally {
      writing.current = false;
      if (live.current) setSaving(false);
    }
  }
  if (!enabled || !value)
    return error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null;
  return (
    <View style={{ gap: space.sm }}>
      <Text style={{ ...type.heading, color: colors.text }} accessibilityRole="header">
        Other suggested times
      </Text>
      <Text style={{ ...type.caption, color: colors.muted }}>
        Suggestions do not change the plan. The host can accept one; everyone must RSVP again.
      </Text>
      <Button
        label="Suggest another time"
        variant="secondary"
        disabled={!!action.busy || saving}
        onPress={() => setEditing(true)}
      />
      {value.suggestions.map((s) => (
        <View key={s.id} style={{ gap: space.sm }}>
          <Text style={{ ...type.body, color: colors.text }}>
            {formatPlanTime(s.planAt)} · {s.displayName ?? 'Participant'} · {s.status}
          </Text>
          {s.status === 'pending' && s.revision === value.revision ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {value.isHost ? (
                <Button
                  label="Accept this time"
                  accessibilityLabel={`Accept ${formatPlanTime(s.planAt)} suggested by ${s.displayName ?? 'participant'}`}
                  variant="secondary"
                  disabled={!!action.busy || saving}
                  onPress={() =>
                    void action.run('accept', () =>
                      mutate(() =>
                        api.actOnTimeSuggestion(pickId, s.id, 'accept', value.revision, viewerId),
                      ),
                    )
                  }
                />
              ) : null}
              {s.proposerId === viewerId ? (
                <Button
                  label="Withdraw"
                  accessibilityLabel={`Withdraw ${formatPlanTime(s.planAt)}`}
                  variant="link"
                  disabled={!!action.busy || saving}
                  onPress={() =>
                    void action.run('withdraw', () =>
                      mutate(() =>
                        api.actOnTimeSuggestion(pickId, s.id, 'withdraw', value.revision, viewerId),
                      ),
                    )
                  }
                />
              ) : null}
            </View>
          ) : null}
        </View>
      ))}
      {action.error || error ? (
        <ErrorBanner message={action.error ?? error ?? ''} onRetry={() => void load()} />
      ) : null}
      {editing ? (
        <PlanTimeSheet
          initial={value.planAt}
          title="Suggest another time"
          submitLabel="Submit suggestion"
          explanation="This is a suggestion. Only the host can change the scheduled time."
          onClose={() => setEditing(false)}
          onSave={(time) => mutate(() => api.suggestTime(pickId, time, value.revision, viewerId))}
        />
      ) : null}
    </View>
  );
}
