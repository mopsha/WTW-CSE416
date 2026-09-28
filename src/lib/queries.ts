// Read-only queries. Clients only READ from Supabase; RLS limits rows to Picks I'm in
// and to my own preferences. Every write goes through src/lib/api.ts.
import { USE_MOCK } from './config';
import { mockQueries } from './mock/queries';
import { candidateFromSnapshot } from './places';
import { getSupabase } from './supabase';
import type {
  Candidate,
  MyPreference,
  PickOutcome,
  PickState,
  PickSummary,
  PreferenceValue,
  RankedPlace,
} from './types';

export interface Queries {
  listMyPicks(userId: string): Promise<PickSummary[]>;
  /** The Pick's candidate pool in a stable order (the order cards are shown in). */
  getCandidates(pickId: string): Promise<Candidate[]>;
  getMyPreferences(pickId: string, userId: string): Promise<MyPreference[]>;
  /** Rank + finalist only. Never selects `score`. */
  getRankingResults(pickId: string): Promise<RankedPlace[]>;
  getPickOutcome(pickId: string): Promise<PickOutcome | null>;
}

export class QueryError extends Error {
  override readonly name = 'QueryError';
}

function check<T>({ data, error }: { data: T | null; error: { message: string } | null }): T {
  if (error) throw new QueryError(error.message);
  if (data === null) throw new QueryError('No data returned.');
  return data;
}

interface PickRow {
  id: string;
  state: PickState;
  category: string;
  deadline_at: string | null;
}

const supabaseQueries: Queries = {
  async listMyPicks(userId) {
    const rows = check(
      await getSupabase()
        .from('pick_participants')
        .select('picks(id, state, category, deadline_at)')
        .eq('user_id', userId),
    ) as unknown as { picks: PickRow | PickRow[] | null }[];
    return rows
      .flatMap((r) => (Array.isArray(r.picks) ? r.picks : r.picks ? [r.picks] : []))
      .map((p) => ({ id: p.id, state: p.state, category: p.category, deadlineAt: p.deadline_at }));
  },

  async getCandidates(pickId) {
    const rows = check(
      await getSupabase()
        .from('pick_candidates')
        .select('place_id, snapshot')
        .eq('pick_id', pickId)
        .order('place_id'),
    ) as { place_id: string; snapshot: unknown }[];
    return rows.map((r) => candidateFromSnapshot(r.place_id, r.snapshot));
  },

  async getMyPreferences(pickId, userId) {
    const rows = check(
      await getSupabase()
        .from('preferences')
        .select('place_id, value')
        .eq('pick_id', pickId)
        .eq('user_id', userId),
    ) as { place_id: string; value: PreferenceValue }[];
    return rows.map((r) => ({ placeId: r.place_id, value: r.value }));
  },

  async getRankingResults(pickId) {
    const rows = check(
      await getSupabase()
        .from('ranking_results')
        .select('place_id, rank, finalist')
        .eq('pick_id', pickId)
        .order('rank'),
    ) as { place_id: string; rank: number; finalist: boolean }[];
    return rows.map((r) => ({ placeId: r.place_id, rank: r.rank, finalist: r.finalist }));
  },

  async getPickOutcome(pickId) {
    const { data, error } = await getSupabase()
      .from('picks')
      .select('state, winner_place_id, decided_by')
      .eq('id', pickId)
      .maybeSingle();
    if (error) throw new QueryError(error.message);
    if (!data) return null;
    const row = data as {
      state: PickState;
      winner_place_id: string | null;
      decided_by: PickOutcome['decidedBy'];
    };
    return { state: row.state, winnerPlaceId: row.winner_place_id, decidedBy: row.decided_by };
  },
};

export const queries: Queries = USE_MOCK ? mockQueries : supabaseQueries;
