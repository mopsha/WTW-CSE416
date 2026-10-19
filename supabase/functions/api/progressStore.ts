import type { ProgressSnapshot, ProgressStore } from '../_shared/api/progress.ts';
import type { PickState } from '../_shared/domain/pickState.ts';
import { createServiceClient } from './serviceClient.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Postgres "relation does not exist" / PostgREST "table not in schema cache". */
const MISSING_TABLE = new Set(['42P01', 'PGRST205']);

/**
 * Service-role reads for GET /picks/:id/progress. Answers are only ever counted here; the
 * values never leave this function.
 */
export function createProgressStore(): ProgressStore {
  return {
    async loadProgress(pickId): Promise<ProgressSnapshot | null> {
      if (!UUID.test(pickId)) return null;
      const db = createServiceClient();
      const fail = (what: string) => {
        throw new Error(`progress: reading ${what} failed`);
      };

      const pick = await db
        .from('picks')
        .select('state, host_id, deadline_at')
        .eq('id', pickId)
        .maybeSingle();
      if (pick.error) fail('picks');
      if (!pick.data) return null;

      const [people, candidates, answers, ballots] = await Promise.all([
        db
          .from('pick_participants')
          .select('user_id, joined_at, profiles(display_name)')
          .eq('pick_id', pickId),
        db
          .from('pick_candidates')
          .select('place_id', { count: 'exact', head: true })
          .eq('pick_id', pickId),
        db.from('preferences').select('user_id').eq('pick_id', pickId),
        db.from('final_votes').select('user_id').eq('pick_id', pickId),
      ]);
      if (people.error) fail('participants');
      if (candidates.error) fail('candidates');
      if (answers.error) fail('preferences');
      // final_votes arrives with the close-and-vote migration; before that nobody has voted.
      if (ballots.error && !MISSING_TABLE.has(ballots.error.code)) fail('final_votes');

      const answered = new Map<string, number>();
      for (const row of (answers.data ?? []) as { user_id: string }[]) {
        answered.set(row.user_id, (answered.get(row.user_id) ?? 0) + 1);
      }
      const voted = new Set(
        ((ballots.error ? [] : ballots.data) ?? []).map((r) => (r as { user_id: string }).user_id),
      );
      const rows = (people.data ?? []) as unknown as {
        user_id: string;
        joined_at: string;
        profiles: { display_name: string | null } | { display_name: string | null }[] | null;
      }[];
      const row = pick.data as { state: PickState; host_id: string; deadline_at: string | null };

      return {
        state: row.state,
        hostId: row.host_id,
        deadlineAt: row.deadline_at,
        candidateCount: candidates.count ?? 0,
        participants: rows.map((p) => {
          const profile = Array.isArray(p.profiles) ? p.profiles[0] : p.profiles;
          return {
            userId: p.user_id,
            displayName: profile?.display_name ?? null,
            joinedAt: p.joined_at,
            answered: answered.get(p.user_id) ?? 0,
            voted: voted.has(p.user_id),
          };
        }),
      };
    },
  };
}
