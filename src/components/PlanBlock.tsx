import { usePrivateRefresh } from '@/hooks/usePrivateRefresh';
import { attendanceDue } from '@shared/domain/pastMoves.ts';
// The Winner screen's "after" part (Alan): when we're going, who's in (counts only), "Did you
// go?", and "Pick again". Everything here is changeable; the server rechecks who may do what.
import { router } from 'expo-router';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { PlanSummary, RsvpStatus } from '@shared/api/plans.ts';

import { useAction } from '@/hooks/useAction';
import { api } from '@/lib/api';
import { formatPlanTime, shouldAskDidYouGo, wentSummary } from '@/lib/plans';

import { Button } from './Button';
import { Chips } from './Chips';
import { ErrorBanner } from './ErrorBanner';
import { Card } from './Card';
import { AvatarStack } from './Avatar';
import { PlanTimeSheet } from './PlanTimeSheet';
import type { ParticipantProgress } from '@/lib/types';
import { colors, fonts, space, type } from './theme';

const PLAN_REFRESH_MS = 30_000;

const RSVP_OPTIONS = [
  { value: 'going', label: 'Going' },
  { value: 'maybe', label: 'Maybe' },
  { value: 'not_going', label: 'Can’t' },
] as const;

export function PlanBlock({
  pickId,
  decidedAt,
  people = [],
  children,
}: {
  pickId: string;
  decidedAt: string | null;
  people?: ParticipantProgress[];
  children?: ReactNode;
}) {
  const [scheduling, setScheduling] = useState(false);
  const inFlight = useRef(false);
  const [plan, setPlan] = useState<PlanSummary | null>(null);
  const [loadError, setLoadError] = useState(false);
  const action = useAction();
  const [editingAttendance, setEditingAttendance] = useState(false);
  // Only the newest reload may update the block, so quick taps can't show a stale answer.
  const latest = useRef(0);

  const load = useCallback(() => {
    const request = ++latest.current;
    return api.getPlan(pickId).then(
      (next) => {
        if (request === latest.current) {
          setPlan(next);
          setLoadError(false);
        }
      },
      // Keep offline data, but never retain a plan after authorization is denied.
      (error: unknown) => {
        if (request === latest.current) setLoadError(true);
        if (
          request === latest.current &&
          typeof error === 'object' &&
          error !== null &&
          'status' in error &&
          [401, 403, 404].includes(Number(error.status))
        )
          setPlan(null);
      },
    );
  }, [pickId]);
  const clear = useCallback(() => {
    latest.current++;
    setPlan(null);
    setLoadError(false);
    setEditingAttendance(false);
    setScheduling(false);
  }, []);
  usePrivateRefresh(load, clear, PLAN_REFRESH_MS);

  // One action at a time: a second tap while one is in flight is ignored.
  const act = (name: string, fn: () => Promise<unknown>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    void action
      .run(name, fn)
      .then((ok) => {
        if (ok) return load();
      })
      .finally(() => {
        inFlight.current = false;
      });
  };

  const again = () =>
    act('again', async () => {
      const { pickId: next } = await api.pickAgain(pickId);
      router.replace(`/pick/${next}`);
    });

  if (!plan)
    return (
      <>
        {loadError ? (
          <ErrorBanner message="Couldn’t load the plan." onRetry={() => void load()} />
        ) : (
          <Text style={styles.muted}>Loading the plan…</Text>
        )}
        {children}
      </>
    );
  const summary = wentSummary(plan);
  const { going, maybe, notGoing } = plan.rsvps;
  const attendanceReady = attendanceDue(plan.planAt, decidedAt);

  return (
    <View style={{ gap: space.lg }}>
      <Card>
        <Text style={styles.section} accessibilityRole="header">
          The plan
        </Text>
        {action.error ? <ErrorBanner message={action.error} /> : null}

        {plan.isHost ? (
          <Card
            variant="flat"
            onPress={() => {
              if (!inFlight.current) setScheduling(true);
            }}
            accessibilityLabel={`${plan.planAt ? formatPlanTime(plan.planAt) : 'No time set'}, edit scheduled time`}
          >
            <Text style={styles.label}>
              {plan.planAt ? formatPlanTime(plan.planAt) : 'Set a time'}
            </Text>
            <Text style={styles.muted}>Change date and time</Text>
          </Card>
        ) : (
          <Text style={styles.label}>
            {plan.planAt ? formatPlanTime(plan.planAt) : 'The host hasn’t set a time yet.'}
          </Text>
        )}
        {people.length ? (
          <View style={styles.row}>
            <AvatarStack
              people={people.map((p) => ({ name: p.displayName ?? 'Member', userId: p.userId }))}
              size={28}
            />
            <Text style={styles.muted}>{plan.participantCount} participants</Text>
          </View>
        ) : null}

        <Text style={styles.label}>Are you in?</Text>
        <Chips
          options={RSVP_OPTIONS}
          value={(plan.myRsvp ?? '') as RsvpStatus}
          onChange={(status) => act('rsvp', () => api.rsvp(pickId, status))}
          accessibilityLabel="Are you going"
        />
        <Text style={styles.muted}>
          {going + maybe + notGoing
            ? `${going} going · ${maybe} maybe · ${notGoing} can’t · ${plan.participantCount - going - maybe - notGoing} awaiting reply`
            : 'Nobody has answered yet.'}
        </Text>
      </Card>
      {shouldAskDidYouGo(plan, decidedAt) ||
      (editingAttendance && attendanceDue(plan.planAt, decidedAt)) ? (
        <Card>
          <Text style={styles.section} accessibilityRole="header">
            Did you go?
          </Text>
          <View style={styles.row}>
            <Button
              label="I went"
              variant="secondary"
              loading={action.busy === 'went'}
              onPress={() =>
                act('went', async () => {
                  await api.recordOutcome(pickId, true);
                  setEditingAttendance(false);
                })
              }
            />
            <Button
              label="I didn’t go"
              variant="secondary"
              loading={action.busy === 'didnt'}
              onPress={() =>
                act('didnt', async () => {
                  await api.recordOutcome(pickId, false);
                  setEditingAttendance(false);
                })
              }
            />
          </View>
        </Card>
      ) : null}
      {attendanceReady && plan.myOutcome?.went && plan.myOutcome.again === null ? (
        <View style={styles.row}>
          <Text style={styles.label}>Would you go again?</Text>
          <Button
            label="Yes"
            variant="secondary"
            loading={action.busy === 'again-yes'}
            onPress={() => act('again-yes', () => api.recordOutcome(pickId, true, true))}
          />
          <Button
            label="No"
            variant="secondary"
            loading={action.busy === 'again-no'}
            onPress={() => act('again-no', () => api.recordOutcome(pickId, true, false))}
          />
        </View>
      ) : null}
      {(plan.myOutcome || plan.myRsvp === 'not_going') && attendanceDue(plan.planAt, decidedAt) ? (
        <>
          {plan.myOutcome?.went ? <Text style={styles.went}>Saved to your Past Moves.</Text> : null}
          <Button
            label={plan.myOutcome ? 'Update my attendance' : 'Record my attendance'}
            variant="link"
            disabled={!!action.busy}
            onPress={() => setEditingAttendance((v) => !v)}
          />
        </>
      ) : null}
      {attendanceReady && summary ? <Text style={styles.went}>{summary}</Text> : null}

      {children}
      {scheduling && plan.isHost ? (
        <PlanTimeSheet
          initial={plan.planAt}
          onClose={() => setScheduling(false)}
          onSave={async (value) => {
            if (inFlight.current) throw new Error('Another change is saving. Try again.');
            inFlight.current = true;
            try {
              await api.setPlanTime(pickId, value);
              setPlan((current) => (current ? { ...current, planAt: value } : current));
              await load();
            } finally {
              inFlight.current = false;
            }
          }}
        />
      ) : null}
      {plan.isHost ? (
        <Button
          label="Pick again with the same group"
          variant="secondary"
          loading={action.busy === 'again'}
          onPress={again}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { ...type.heading, color: colors.text },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  label: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
  muted: { fontFamily: fonts.medium, fontSize: 14, color: colors.muted },
  went: { fontFamily: fonts.bold, fontSize: 15, color: colors.yes },
});
