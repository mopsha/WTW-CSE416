import type { SweepStore } from '../_shared/api/sweep.ts';
import { createServiceClient } from './serviceClient.ts';

export function createSweepStore(): SweepStore {
  return {
    async expiredPage(phase, cutoff, after) {
      const deadline = phase === 'swiping' ? 'deadline_at' : 'vote_deadline_at';
      let query = createServiceClient()
        .from('picks')
        .select('id')
        .eq('state', phase)
        .lte(deadline, cutoff)
        .order('id', { ascending: true })
        .limit(100);
      if (after) query = query.gt('id', after);
      const { data, error } = await query;
      if (error) throw new Error('Sweep query failed');
      return data ?? [];
    },
    async reminderTargets(from, until) {
      const { data, error } = await createServiceClient().rpc('pick_reminder_targets', {
        p_from: from,
        p_until: until,
      });
      if (error) throw new Error('Reminder query failed');
      return ((data ?? []) as { pick_id: string; user_ids: string[] }[]).map((r) => ({
        pickId: r.pick_id,
        userIds: r.user_ids,
      }));
    },
    async planTargets(now) {
      const { data, error } = await createServiceClient().rpc('pick_plan_targets', {
        p_now: now,
      });
      if (error) throw new Error('Plan query failed');
      return (
        (data ?? []) as {
          pick_id: string;
          kind: 'plan_reminder' | 'did_you_go';
          user_ids: string[];
        }[]
      ).map((r) => ({ pickId: r.pick_id, kind: r.kind, userIds: r.user_ids }));
    },
  };
}
