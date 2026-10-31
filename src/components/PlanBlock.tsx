// The Winner screen's "after" part (Alan): when we're going, who's in (counts only), "Did you
// go?", and "Pick again". Everything here is changeable; the server rechecks who may do what.
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { PlanSummary, RsvpStatus } from '@shared/api/plans.ts';

import { useAction } from '@/hooks/useAction';
import { api } from '@/lib/api';
import { formatPlanTime, planTimeOptions, shouldAskDidYouGo, wentSummary } from '@/lib/plans';

import { Button } from './Button';
import { Chips } from './Chips';
import { ErrorBanner } from './ErrorBanner';
import { pickStyles } from './PickParts';
import { colors, fonts } from './theme';

const RSVP_OPTIONS = [
  { value: 'going', label: 'Going' },
  { value: 'maybe', label: 'Maybe' },
  { value: 'not_going', label: 'Can’t' },
] as const;

export function PlanBlock({ pickId, decidedAt }: { pickId: string; decidedAt: string | null }) {
  const [plan, setPlan] = useState<PlanSummary | null>(null);
  const action = useAction();

  const load = useCallback(() => {
    api.getPlan(pickId).then(setPlan, () => setPlan(null));
  }, [pickId]);
  useEffect(load, [load]);

  const act = (name: string, fn: () => Promise<unknown>) =>
    void action.run(name, fn).then((ok) => ok && load());

  const again = () =>
    void action.run('again', async () => {
      const { pickId: next } = await api.pickAgain(pickId);
      router.replace(`/pick/${next}`);
    });

  if (!plan) return null;
  const summary = wentSummary(plan);
  const { going, maybe } = plan.rsvps;

  return (
    <View style={pickStyles.card} accessibilityLabel="The plan">
      {action.error ? <ErrorBanner message={action.error} /> : null}

      <Text style={pickStyles.section}>
        {plan.planAt ? `📅 ${formatPlanTime(plan.planAt)}` : 'When are you going?'}
      </Text>
      {plan.isHost ? (
        <View style={styles.row}>
          {planTimeOptions().map((o) => (
            <Button
              key={o.label}
              label={o.label}
              variant="secondary"
              loading={action.busy === `time-${o.label}`}
              onPress={() => act(`time-${o.label}`, () => api.setPlanTime(pickId, o.value))}
            />
          ))}
        </View>
      ) : !plan.planAt ? (
        <Text style={styles.muted}>The host hasn’t set a time yet.</Text>
      ) : null}

      <Text style={styles.label}>Are you in?</Text>
      <Chips
        options={RSVP_OPTIONS}
        value={(plan.myRsvp ?? '') as RsvpStatus}
        onChange={(status) => act('rsvp', () => api.rsvp(pickId, status))}
        accessibilityLabel="Are you going"
      />
      <Text style={styles.muted}>
        {going + maybe
          ? `${going} going${maybe ? `, ${maybe} maybe` : ''} of ${plan.participantCount}`
          : 'Nobody has answered yet.'}
      </Text>

      {shouldAskDidYouGo(plan, decidedAt) ? (
        <View style={styles.ask}>
          <Text style={pickStyles.section}>Did you go? 👀</Text>
          <View style={styles.row}>
            <Button
              label="We went 🎉"
              variant="secondary"
              loading={action.busy === 'went'}
              onPress={() => act('went', () => api.recordOutcome(pickId, true))}
            />
            <Button
              label="Didn’t happen"
              variant="secondary"
              loading={action.busy === 'didnt'}
              onPress={() => act('didnt', () => api.recordOutcome(pickId, false))}
            />
          </View>
        </View>
      ) : null}
      {plan.myOutcome?.went && plan.myOutcome.again === null ? (
        <View style={styles.row}>
          <Text style={styles.label}>Would you go again?</Text>
          <Button
            label="Yes"
            variant="secondary"
            onPress={() => act('again-yes', () => api.recordOutcome(pickId, true, true))}
          />
          <Button
            label="No"
            variant="secondary"
            onPress={() => act('again-no', () => api.recordOutcome(pickId, true, false))}
          />
        </View>
      ) : null}
      {summary ? <Text style={styles.went}>{summary}</Text> : null}

      <Button
        label="Pick again with the same group"
        variant="secondary"
        loading={action.busy === 'again'}
        onPress={again}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  label: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
  muted: { fontFamily: fonts.medium, fontSize: 14, color: colors.muted },
  went: { fontFamily: fonts.bold, fontSize: 15, color: colors.yes },
  ask: { gap: 8, paddingTop: 4 },
});
