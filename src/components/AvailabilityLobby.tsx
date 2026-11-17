import { useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { Button, Screen, Chips, colors, space, type, ErrorState, Avatar } from '@/components';
import {
  availabilityCounts,
  type Availability,
  type AvailabilityResponse,
} from '@shared/domain/availability.ts';
import type { PickState } from '@/lib/types';
import { useAuth } from '@/hooks/useAuth';
import { useAction } from '@/hooks/useAction';
import { api } from '@/lib/api';
import { pathFor, screenForState } from '@/lib/pickRoute';
import { formatPlanTime } from '@/lib/plans';
/** Individual entry into the existing active Pick, never a host approval stage. */
export function AvailabilityLobby({
  pickId,
  value,
  isHost,
  state,
  onCancel,
  refresh,
  pending,
  context,
  error,
  onInvite,
  doneCount = 0,
  total = 0,
}: {
  pickId: string;
  value: Availability;
  isHost: boolean;
  state: PickState;
  onCancel: () => void;
  refresh: () => Promise<void>;
  pending: boolean;
  context?: string;
  error?: string | null;
  onInvite?: () => void;
  doneCount?: number;
  total?: number;
}) {
  const { session } = useAuth();
  const viewer = session?.user.id;
  const action = useAction();
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const me = value.participants.find((p) => p.userId === viewer);
  const [selection, setSelection] = useState<AvailabilityResponse | null>(null);
  const selected =
    me?.started && selection === 'cant'
      ? (me.response ?? 'yes')
      : (selection ?? me?.response ?? 'none');
  const [following, setFollowing] = useState(me?.response === 'cant');
  const navigateAfterConfirmation = useRef<AvailabilityResponse | null>(null);
  const open = state === 'swiping' && !value.locked && value.responseOpen !== false;
  const busy = pending || !!action.busy;
  const counts = availabilityCounts(value);
  useEffect(() => {
    const desired = navigateAfterConfirmation.current;
    if (!desired || action.busy || me?.response !== desired) return;
    navigateAfterConfirmation.current = null;
    if (desired === 'cant') {
      setFollowing(true);
      return;
    }
    const target = screenForState(state, { canVote: value.canVote });
    if (target !== 'lobby') router.replace({ pathname: pathFor(target), params: { id: pickId } });
  }, [me?.response, action.busy, state, value.canVote, pickId]);
  const submit = () =>
    void action.run('availability', async () => {
      if (!viewer || selected === 'none') return;
      try {
        await api.respondAvailability(pickId, value.revision, selected, viewer);
        if (active.current) {
          await refresh();
          if (active.current) navigateAfterConfirmation.current = selected;
        }
      } catch (e) {
        if (active.current) await refresh(); // reconcile closed rounds or an ambiguous write
        throw e;
      }
    });
  return (
    <Screen
      title={following || !open ? 'Following the Pick' : 'You’re invited'}
      back
      onRefresh={() => void refresh()}
    >
      {context ? <Text style={{ ...type.heading, color: colors.text }}>{context}</Text> : null}
      {value.groupName ? (
        <Text style={{ ...type.body, color: colors.text }}>{value.groupName}</Text>
      ) : null}
      <Text style={{ ...type.heading, color: colors.primary }} accessibilityRole="header">
        {formatPlanTime(value.proposedAt)} · Proposed time
      </Text>
      <Text style={{ ...type.heading, color: colors.text }} accessibilityRole="header">
        Are you down?
      </Text>
      {open && !following ? (
        <>
          <Chips<AvailabilityResponse | 'none'>
            accessibilityLabel="Your availability"
            value={selected}
            disabled={busy || !viewer}
            options={
              me?.started
                ? [
                    { value: 'yes', label: 'I’m in' },
                    { value: 'maybe', label: 'Maybe' },
                  ]
                : [
                    { value: 'yes', label: 'I’m in' },
                    { value: 'maybe', label: 'Maybe' },
                    { value: 'cant', label: 'Can’t' },
                  ]
            }
            onChange={(choice) => {
              if (choice !== 'none') setSelection(choice);
            }}
          />
          <Text style={{ ...type.caption, color: colors.muted }}>
            Time not ideal? The group can revisit the time after deciding.
          </Text>
          <Text style={{ ...type.caption, color: colors.muted }}>
            Yes or Maybe lets you join immediately. Availability is not attendance confirmation.
          </Text>
          {me?.started ? (
            <Text style={{ ...type.caption, color: colors.muted }}>
              Your voting place is kept after your first swipe. You can change Yes to Maybe, and
              update attendance after results.
            </Text>
          ) : null}
          <Button
            label={
              selected === 'none'
                ? 'Choose your response'
                : selected === 'cant'
                  ? 'View Pick'
                  : 'Start swiping'
            }
            disabled={busy || selected === 'none' || !viewer}
            loading={action.busy === 'availability'}
            onPress={submit}
          />
        </>
      ) : (
        <>
          <Text style={{ ...type.body, color: colors.text }}>
            {open
              ? 'You’re following without voting. You can change your availability while swiping remains open.'
              : 'This round is closed to new responses. You can follow the decision and see the results.'}
          </Text>
          {open ? (
            <Button
              label="Change availability"
              variant="secondary"
              disabled={busy}
              onPress={() => setFollowing(false)}
            />
          ) : null}
        </>
      )}
      <Text accessibilityLiveRegion="polite" style={{ ...type.body, color: colors.text }}>
        {counts.yes} in · {counts.maybe} maybe · {counts.cant} can’t · {counts.awaiting} awaiting
      </Text>
      <Text style={{ ...type.caption, color: colors.muted }}>
        {total} eligible · {value.participants.filter((p) => p.started).length} started ·{' '}
        {doneCount} finished swiping
      </Text>
      {value.participants.map((p) => (
        <View
          key={p.userId}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.md,
            paddingVertical: space.sm,
          }}
        >
          <Avatar name={p.displayName} />
          <Text style={{ ...type.body, color: colors.text, flex: 1 }}>
            {p.displayName} ·{' '}
            {p.response === 'yes'
              ? 'In'
              : p.response === 'maybe'
                ? 'Maybe'
                : p.response === 'cant'
                  ? 'Can’t'
                  : 'Awaiting'}
          </Text>
        </View>
      ))}
      {isHost ? (
        <Text style={{ ...type.caption, color: colors.muted }}>
          At 100%, unanswered invitations keep automatic completion open. You can close manually or
          use the swipe deadline. A lower configured threshold can close earlier.
        </Text>
      ) : null}
      {isHost && onInvite ? (
        <Button label="Share invite" variant="secondary" onPress={onInvite} />
      ) : null}
      {value.deadlineMinutes === 0 ? (
        <Text style={{ ...type.caption, color: colors.muted }}>
          No swipe deadline. The host can close the round manually.
        </Text>
      ) : null}
      {isHost && (state === 'swiping' || state === 'final_vote') ? (
        <Button
          label={state === 'swiping' ? 'Close swiping' : 'Close final vote'}
          disabled={busy}
          onPress={() =>
            void action.run('close', async () => {
              if (state === 'swiping') await api.closePick(pickId);
              else await api.closeVote(pickId);
              if (active.current) await refresh();
            })
          }
        />
      ) : null}
      {isHost && state !== 'completed' && state !== 'canceled' ? (
        <Button label="Cancel Pick" variant="danger" disabled={busy} onPress={onCancel} />
      ) : null}
      {error ? <ErrorState message={error} onRetry={() => void refresh()} /> : null}
      {action.error ? <ErrorState message={action.error} onRetry={submit} /> : null}
    </Screen>
  );
}
