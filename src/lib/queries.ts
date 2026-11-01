// Read-only queries. Clients only READ from Supabase; RLS limits rows to Picks I'm in
// and to my own preferences. Every write goes through src/lib/api.ts.
import { USE_MOCK } from './config';
import { sortMembers, type FriendOption, type GroupDetail, type GroupSummary } from './groups';
import { mockQueries } from './mock/queries';
import { getSupabase } from './supabase';
import type {
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
  getMyPreferences(pickId: string, userId: string): Promise<MyPreference[]>;
  /** Rank + finalist only. Never selects `score`. */
  getRankingResults(pickId: string): Promise<RankedPlace[]>;
  getPickOutcome(pickId: string): Promise<PickOutcome | null>;
  /** My own final-vote ballot (RLS: only mine), or null if I haven't voted. */
  getMyVote(pickId: string, userId: string): Promise<string | null>;
  /** The Pick's share code (Razin's pick_join_codes), or null if there isn't one yet. */
  getJoinCode(pickId: string): Promise<JoinCode | null>;
  /** Groups I'm in (RLS: members only), by name. */
  listMyGroups(userId: string): Promise<GroupSummary[]>;
  /** A group I'm in, its members, and its Picks I'm in; null if it's gone or I'm not in it. */
  getGroup(groupId: string): Promise<GroupDetail | null>;
  /** My accepted friends (0008's friendships, PR #24); [] until that table exists. */
  listMyFriends(userId: string): Promise<FriendOption[]>;
  /** picks.lobby_locked (0014): the host stopped new people joining by code or link. */
  getLobbyLocked(pickId: string): Promise<boolean>;
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
      host_id: string | null;
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

  async getLobbyLocked(pickId) {
    const { data, error } = await getSupabase()
      .from('picks')
      .select('lobby_locked')
      .eq('id', pickId)
      .maybeSingle();
    if (error) throw new QueryError(error.message);
    return (data as { lobby_locked?: boolean } | null)?.lobby_locked === true;
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

  async listMyGroups(userId) {
    const rows = check(
      await getSupabase()
        .from('group_members')
        .select('groups(id, name, owner_id, group_members(count))')
        .eq('user_id', userId),
    ) as unknown as { groups: GroupRow | GroupRow[] | null }[];
    return rows
      .flatMap((r) => (Array.isArray(r.groups) ? r.groups : r.groups ? [r.groups] : []))
      .map((g) => ({
        id: g.id,
        name: g.name,
        ownerId: g.owner_id,
        isOwner: g.owner_id === userId,
        memberCount: g.group_members?.[0]?.count ?? 1,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  async getGroup(groupId) {
    const { data, error } = await getSupabase()
      .from('groups')
      .select('id, name, owner_id, group_members(user_id, role, profiles(display_name))')
      .eq('id', groupId)
      .maybeSingle();
    if (error) throw new QueryError(error.message);
    if (!data) return null;
    const g = data as unknown as {
      id: string;
      name: string;
      owner_id: string;
      group_members: {
        user_id: string;
        role: 'owner' | 'member';
        profiles: { display_name: string | null } | null;
      }[];
    };
    // RLS on picks: only the group's Picks I'm in (a removed member keeps theirs).
    const picks = check(
      await getSupabase()
        .from('picks')
        .select('id, state, category, deadline_at')
        .eq('group_id', groupId)
        .order('created_at', { ascending: false })
        .limit(10),
    ) as PickRow[];
    return {
      id: g.id,
      name: g.name,
      ownerId: g.owner_id,
      members: sortMembers(
        g.group_members.map((m) => ({
          userId: m.user_id,
          displayName: m.profiles?.display_name?.trim() || null,
          role: m.role,
        })),
      ),
      picks: picks.map((p) => ({
        id: p.id,
        state: p.state,
        category: p.category,
        deadlineAt: p.deadline_at,
      })),
    };
  },

  async listMyFriends(userId) {
    const { data, error } = await getSupabase()
      .from('friendships')
      .select('requester_id, addressee_id')
      .eq('status', 'accepted');
    // Before 0008_friendships (PR #24) is applied there is no table: nobody to add yet.
    if (error) {
      if (error.code === 'PGRST205' || error.code === '42P01') return [];
      throw new QueryError(error.message);
    }
    const ids = ((data ?? []) as { requester_id: string; addressee_id: string }[]).map((f) =>
      f.requester_id === userId ? f.addressee_id : f.requester_id,
    );
    if (ids.length === 0) return [];
    const profiles = check(
      await getSupabase().from('profiles').select('id, display_name').in('id', ids),
    ) as { id: string; display_name: string | null }[];
    const names = new Map(profiles.map((p) => [p.id, p.display_name?.trim() || null]));
    return ids.map((id) => ({ userId: id, displayName: names.get(id) ?? null }));
  },
};

interface GroupRow {
  id: string;
  name: string;
  owner_id: string;
  group_members: { count: number }[] | null;
}

export const queries: Queries = USE_MOCK ? mockQueries : supabaseQueries;
