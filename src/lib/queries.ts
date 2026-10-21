// Read-only queries. Clients only READ from Supabase; RLS limits rows to Picks I'm in
// and to my own preferences. Every write goes through src/lib/api.ts.
import { USE_MOCK } from './config';
import { api } from './api';
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
  /** My own profile (RLS: I can always read my row). displayName is null until I pick one. */
  getMyProfile(userId: string): Promise<MyProfile>;
  listMyPicks(userId: string): Promise<PickSummary[]>;
  /** The Pick's candidate pool in a stable order (the order cards are shown in). */
  getCandidates(pickId: string): Promise<Candidate[]>;
  getMyPreferences(pickId: string, userId: string): Promise<MyPreference[]>;
  /** Rank + finalist only. Never selects `score`. */
  getRankingResults(pickId: string): Promise<RankedPlace[]>;
  getPickOutcome(pickId: string): Promise<PickOutcome | null>;
  /** My own final-vote ballot (RLS: only mine), or null if I haven't voted. */
  getMyVote(pickId: string, userId: string): Promise<string | null>;
  /** The Pick's share code (Razin's pick_join_codes), or null if there isn't one yet. */
  getJoinCode(pickId: string): Promise<JoinCode | null>;
}

export interface MyProfile {
  displayName: string | null;
}

export interface JoinCode {
  code: string;
  expiresAt: string | null;
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
  async getMyProfile(userId) {
    const { data, error } = await getSupabase()
      .from('profiles')
      .select('display_name')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw new QueryError(error.message);
    const name = (data as { display_name: string | null } | null)?.display_name?.trim();
    return { displayName: name || null };
  },

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
    const candidates = rows.map((r) => candidateFromSnapshot(r.place_id, r.snapshot));
    // The existing authenticated Pick reader refreshes hours only at reveal/results.
    // Optional metadata failures must not hide the persisted pool or outcome.
    try {
      const { candidateHours = [] } = await api.getPickHours(pickId);
      const byId = new Map(candidateHours.map((h) => [h.placeId, h]));
      return candidates.map((c) => ({
        ...c,
        openNow: byId.get(c.placeId)?.openNow ?? null,
        closesAt: byId.get(c.placeId)?.closesAt ?? null,
      }));
    } catch {
      return candidates.map((c) => ({ ...c, openNow: null, closesAt: null }));
    }
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
      .select('state, host_id, winner_place_id, decided_by')
      .eq('id', pickId)
      .maybeSingle();
    if (error) throw new QueryError(error.message);
    if (!data) return null;
    const row = data as {
      state: PickState;
      host_id: string;
      winner_place_id: string | null;
      decided_by: PickOutcome['decidedBy'];
    };
    return {
      state: row.state,
      hostId: row.host_id,
      winnerPlaceId: row.winner_place_id,
      decidedBy: row.decided_by,
    };
  },

  async getMyVote(pickId, userId) {
    const { data, error } = await getSupabase()
      .from('final_votes')
      .select('place_id')
      .eq('pick_id', pickId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new QueryError(error.message);
    return (data as { place_id: string } | null)?.place_id ?? null;
  },

  async getJoinCode(pickId) {
    const { data, error } = await getSupabase()
      .from('pick_join_codes')
      .select('code, expires_at')
      .eq('pick_id', pickId)
      .order('expires_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    // Before Razin's join-code migration lands the table doesn't exist; the lobby shows a
    // placeholder rather than an error.
    if (error) return null;
    const row = data as { code: string; expires_at: string | null } | null;
    return row ? { code: row.code, expiresAt: row.expires_at } : null;
  },
};

export const queries: Queries = USE_MOCK ? mockQueries : supabaseQueries;
