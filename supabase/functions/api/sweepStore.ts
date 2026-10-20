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
  };
}
