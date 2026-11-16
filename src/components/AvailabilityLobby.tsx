import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Screen, Chips, colors, space, type, ErrorState, Avatar } from '@/components';
import { PlanTimeSheet } from './PlanTimeSheet';
import {
  availabilityCounts,
  type Availability,
  type AvailabilityResponse,
} from '@shared/domain/availability.ts';
import type { PickState } from '@/lib/types';
import { useAuth } from '@/hooks/useAuth';
import { useAction } from '@/hooks/useAction';
import { api } from '@/lib/api';
import { formatPlanTime } from '@/lib/plans';
/** Owned by the existing lobby; metadata and eligibility always come from the server. */
export function AvailabilityLobby({
  pickId,
  value,
  isHost,
  state,
  onStart,
  onCancel,
  refresh,
  pending,
  context,
  error,
}: {
  pickId: string;
  value: Availability;
  isHost: boolean;
  state: PickState;
  onStart: () => void;
  onCancel: () => void;
  refresh: () => Promise<void>;
  pending: boolean;
  context?: string;
  error?: string | null;
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
  const [editing, setEditing] = useState(false);
  const counts = availabilityCounts(value);
  const myResponse = value.participants.find((p) => p.userId === viewer)?.response;
  const open = state === 'draft' && !value.locked;
  const busy = pending || !!action.busy;
  return (
    <Screen
      title={open ? 'Are you down?' : 'Waiting for the plan'}
      back
      onRefresh={() => void refresh()}
    >
      {context ? <Text style={{ ...type.body, color: colors.text }}>{context}</Text> : null}
      <Text accessibilityRole="header" style={{ ...type.heading, color: colors.primary }}>
        {formatPlanTime(value.proposedAt)}
      </Text>
      <Text style={{ ...type.body, color: colors.text }}>
        {open
          ? 'Confirm availability before swiping begins. Yes and Maybe responses can join this decision round.'
          : 'The voting group is locked. You can view the winning plan when it is ready.'}
      </Text>
      <Text accessibilityLiveRegion="polite" style={{ ...type.body, color: colors.text }}>
        {counts.yes} in · {counts.maybe} maybe · {counts.cant} can’t · {counts.awaiting} awaiting
      </Text>
      {open ? (
        <Chips<AvailabilityResponse | 'none'>
          accessibilityLabel="Your availability"
          value={myResponse ?? 'none'}
          disabled={busy || !viewer}
          options={[
            { value: 'yes', label: 'I’m in' },
            { value: 'maybe', label: 'Maybe' },
            { value: 'cant', label: 'Can’t' },
          ]}
          onChange={(response) => {
            if (response === 'none') return;
            void action.run(response, async () => {
              if (!viewer) return;
              await api.respondAvailability(pickId, value.revision, response, viewer);
              if (active.current) await refresh();
            });
          }}
        />
      ) : null}
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
      <Text style={{ ...type.caption, color: colors.muted }}>
        Open Now describes places open when the deck is generated, not future opening-hour
        guarantees.
      </Text>
      {value.deadlineMinutes === 0 ? (
        <Text style={{ ...type.caption, color: colors.muted }}>
          No swipe deadline is set. The host must close swiping in time for the outing; the final
          vote can take 30 minutes.
        </Text>
      ) : null}
      {isHost && open ? (
        <>
          <Text style={{ ...type.caption, color: colors.muted }}>
            Starting includes only current Yes and Maybe respondents. Others can still view the
            eventual plan. At least two respondents are required.
          </Text>
          <Button
            label="Start Swiping"
            disabled={busy || counts.yes + counts.maybe < 2}
            loading={pending}
            onPress={onStart}
          />
          <Button
            label="Change Time"
            variant="secondary"
            disabled={busy}
            onPress={() => setEditing(true)}
          />
        </>
      ) : null}
      {isHost && !open && (state === 'swiping' || state === 'final_vote') ? (
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
      {action.error ? <ErrorState message={action.error} onRetry={() => void refresh()} /> : null}
      {editing && viewer ? (
        <PlanTimeSheet
          initial={value.proposedAt}
          onClose={() => setEditing(false)}
          onSave={async (proposedAt) => {
            await api.changeProposedTime(pickId, value.revision, proposedAt, viewer);
            if (active.current) await refresh();
          }}
        />
      ) : null}
    </Screen>
  );
}
