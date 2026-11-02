// Typed client for our Edge Function (`${EXPO_PUBLIC_SUPABASE_URL}/functions/v1/api`).
// Every write goes through here with the user's access token; reads use Supabase + RLS.
import { getAccessToken } from './auth';
import { API_BASE_URL, USE_MOCK } from './config';
import { MOCK_API_BASE_URL, mockFetch } from './mock/api';
import type { NotificationRow } from '@shared/api/notify.ts';
import type { HistoryItem, PlanSummary, RsvpStatus } from '@shared/api/plans.ts';
import type { CreatePickInput } from '@shared/domain/createPick.ts';
import type { FriendsList } from '@shared/api/friends.ts';
import type { MeResponse } from '@shared/api/profile.ts';
import type { Preferences } from '@shared/domain/preferences.ts';
import type { GroupSummary as CreatedGroup } from '@shared/api/groups.ts';

import { candidateFromApi } from './places';
import type {
  PickDetail,
  PickProgress,
  PickState,
  PreferenceValue,
  RankDecision,
  RankPosition,
} from './types';

/** Error codes the app itself produces; server codes pass through as-is. */
export type ClientErrorCode = 'network_error' | 'not_signed_in' | `http_${number}`;

export class ApiError extends Error {
  override readonly name = 'ApiError';
  constructor(
    /** Server `error.code`, or a ClientErrorCode. */
    readonly code: string,
    message: string,
    /** HTTP status; 0 when the request never got a response. */
    readonly status: number,
  ) {
    super(message);
  }
}

/** Reads the API's `{ error: { code, message } }` body. Returns null for any other shape. */
export function parseErrorBody(body: unknown): { code: string; message: string } | null {
  if (typeof body !== 'object' || body === null || !('error' in body)) return null;
  const { error } = body;
  if (typeof error !== 'object' || error === null) return null;
  const code = 'code' in error ? error.code : undefined;
  const message = 'message' in error ? error.message : undefined;
  if (typeof code !== 'string' || typeof message !== 'string') return null;
  return { code, message };
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface ApiClientOptions {
  baseUrl: string;
  getAccessToken: () => Promise<string | null>;
  fetch: FetchLike;
}

export type InviteKind = 'pick' | 'group';

/** POST /invites. `url` is the wtw://i/TOKEN deep link. */
export interface InviteLinkResponse {
  token: string;
  url: string;
  kind: InviteKind;
  targetId: string;
  expiresAt: string;
  maxUses: number | null;
}

/** GET /health and POST /picks/:id/swipes. */
export interface StatusResponse {
  status: 'ok';
}

/** POST /picks/:id/rank (host only). Rank positions only; scores stay server-side. */
export interface RankResponse {
  /** Top three, in order. */
  results: RankPosition[];
  decision: RankDecision;
}

/**
 * POST /picks (proposed, see docs/api-integration.md). The caller becomes host and
 * first participant; the server fills the candidate pool. 201 on success.
 */
export interface CreatePickResponse {
  pickId: string;
  state: PickState;
}

/** POST /picks/:id/close: what closePick decided. */
export interface CloseResponse {
  state: 'completed' | 'final_vote';
  winnerPlaceId: string | null;
  finalists: string[];
}

/** Opening hours the server refreshes at reveal (Josh's `candidateHours` on GET /picks/:id). */
export interface CandidateHours {
  placeId: string;
  openNow: boolean | null;
  closesAt: string | null;
}

type RawPickDetail = Omit<PickDetail, 'candidates'> & {
  candidates: unknown[];
  /** Only in final_vote / completed, and only once the hours route is deployed. */
  candidateHours?: CandidateHours[];
};

/** Normalize GET /picks/:id: candidate snapshots -> Candidate, hours merged onto each place. */
export function pickDetailFromApi(raw: RawPickDetail): PickDetail {
  const { candidateHours = [], ...rest } = raw;
  const hours = new Map(candidateHours.map((h) => [h.placeId, h]));
  return {
    ...rest,
    candidates: (raw.candidates ?? []).map((snapshot) => {
      const c = candidateFromApi(snapshot);
      const h = hours.get(c.placeId);
      return h ? { ...c, openNow: h.openNow, closesAt: h.closesAt } : c;
    }),
  };
}

export function createApiClient({ baseUrl, getAccessToken, fetch }: ApiClientOptions) {
  async function request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    { body, auth = true }: { body?: unknown; auth?: boolean } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (auth) {
      const token = await getAccessToken();
      if (!token) throw new ApiError('not_signed_in', 'Please sign in again.', 401);
      headers.Authorization = `Bearer ${token}`;
    }
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let res: Response;
    try {
      res = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError('network_error', 'Can’t reach WTW. Check your connection.', 0);
    }

    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }

    if (!res.ok) {
      const err = parseErrorBody(json);
      throw new ApiError(
        err?.code ?? `http_${res.status}`,
        err?.message ?? `Something went wrong (${res.status}).`,
        res.status,
      );
    }
    return json as T;
  }

  const pickPath = (pickId: string) => `/picks/${encodeURIComponent(pickId)}`;
  const groupPath = (groupId: string) => `/groups/${encodeURIComponent(groupId)}`;

  return {
    discover: (params: {
      lat: number;
      lng: number;
      radiusM?: number;
      category?: string;
      priceMax?: number;
      openNow?: boolean;
    }) => {
      const query = new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)]),
      );
      return request<{
        places: import('@shared/places/types.ts').Candidate[];
        fallback: boolean;
        notice: string | null;
      }>('GET', `/discover?${query}`);
    },
    getSaved: () => request<{ places: { placeId: string; createdAt: string }[] }>('GET', '/saved'),
    savePlace: (placeId: string) =>
      request<StatusResponse>('POST', `/saved/${encodeURIComponent(placeId)}`),
    removeSaved: (placeId: string) =>
      request<StatusResponse>('DELETE', `/saved/${encodeURIComponent(placeId)}`),
    getHang: () =>
      request<{
        posts: import('@shared/api/hang.ts').HangPost[];
        sharedAvailable: boolean;
        notice: string;
      }>('GET', '/hang'),
    createHang: (input: import('@shared/api/hang.ts').HangInput) =>
      request<import('@shared/api/hang.ts').HangPost>('POST', '/hang', { body: input }),
    respondHang: (id: string, status: import('@shared/api/hang.ts').HangStatus) =>
      request<StatusResponse>('POST', `/hang/${encodeURIComponent(id)}/respond`, {
        body: { status },
      }),
    hangPick: (id: string, input: CreatePickInput) =>
      request<{ pickId: string; isParticipant: boolean }>(
        'POST',
        `/hang/${encodeURIComponent(id)}/pick`,
        { body: input },
      ),
    health: () => request<StatusResponse>('GET', '/health', { auth: false }),
    /** Validate with validateCreatePick first; the server rejects bad input with 400 INVALID_INPUT. */
    createPick: (input: CreatePickInput) =>
      request<CreatePickResponse>('POST', '/picks', { body: input }),
    /**
     * Join by code (any case, spaces ignored). 404 JOIN_CODE_NOT_FOUND for an unknown or expired
     * code, 409 PICK_CLOSED once the Pick is past swiping. Already in it: same { pickId }.
     */
    joinPick: (code: string) =>
      request<{ pickId: string }>('POST', '/picks/join', { body: { code } }),
    /** My display name (trimmed, 1–50 characters; 400 INVALID_INPUT otherwise). Only ever mine. */
    updateMe: (displayName: string) =>
      request<{ displayName: string }>('POST', '/me', { body: { displayName } }),
    /** My name, survey answers and whether onboarding is done (survey answers are API-only). */
    getMe: () => request<MeResponse>('GET', '/me'),
    /** Saves the survey (FR-02); even all-empty answers mark onboarding done. */
    savePreferences: (preferences: Preferences) =>
      request<{ preferences: Preferences; onboarded: true }>('POST', '/me/preferences', {
        body: { preferences },
      }),
    /** Alan's POST /push-tokens: this device's Expo push token, so Pick events reach it. */
    registerPushToken: (token: string, platform: 'ios' | 'android') =>
      request<StatusResponse>('POST', '/push-tokens', { body: { token, platform } }),
    /** Stop this device getting my pushes (call before signing out). Only ever my own token. */
    removePushToken: (token: string) =>
      request<StatusResponse>('POST', '/push-tokens/remove', { body: { token } }),
    /** Razin's DELETE /me: deletes my account and its data. Sign out afterwards. */
    deleteMe: () => request<StatusResponse>('DELETE', '/me'),

    // Groups (0012_groups.sql). Reads are RLS queries (queries.listMyGroups / getGroup).
    /** A draft Pick with everyone in the group already in it. 404 GROUP_NOT_FOUND if I'm not in it. */
    createGroupPick: (input: CreatePickInput, groupId: string) =>
      request<CreatePickResponse & { groupId: string; added: number }>('POST', '/picks', {
        body: { ...input, groupId },
      }),
    /** Host only: add friends to a draft or swiping Pick. 403 NOT_FRIENDS for anyone else. */
    inviteToPick: (pickId: string, userIds: string[]) =>
      request<{ added: number }>('POST', `${pickPath(pickId)}/invite`, { body: { userIds } }),
    createGroup: (name: string) => request<CreatedGroup>('POST', '/groups', { body: { name } }),
    /** Owner only. */
    renameGroup: (groupId: string, name: string) =>
      request<StatusResponse>('POST', `${groupPath(groupId)}/rename`, { body: { name } }),
    /** Owner only. Past Picks and their results stay. */
    deleteGroup: (groupId: string) =>
      request<StatusResponse>('POST', `${groupPath(groupId)}/delete`),
    /** Owner only; accepted friends only (403 NOT_FRIENDS). Already-members are skipped. */
    addGroupMembers: (groupId: string, userIds: string[]) =>
      request<{ added: number }>('POST', `${groupPath(groupId)}/members`, { body: { userIds } }),
    /** Owner only. They keep past Picks; new group Picks won't include them. */
    removeGroupMember: (groupId: string, userId: string) =>
      request<StatusResponse>(
        'POST',
        `${groupPath(groupId)}/members/${encodeURIComponent(userId)}/remove`,
      ),
    /** Anyone but the owner (409 OWNER_CANNOT_LEAVE). */
    leaveGroup: (groupId: string) => request<StatusResponse>('POST', `${groupPath(groupId)}/leave`),
    /** Host only: a wtw://i/TOKEN link to share (7 days, unlimited uses unless maxUses). */
    createInvite: (input: { kind: InviteKind; targetId: string; maxUses?: number | null }) =>
      request<InviteLinkResponse>('POST', '/invites', { body: input }),
    /** Every unusable link is 404 INVITE_NOT_FOUND; too many failed joins is 429 RATE_LIMITED. */
    acceptInvite: (token: string) =>
      request<{ kind: InviteKind; targetId: string }>(
        'POST',
        `/invites/${encodeURIComponent(token)}/accept`,
      ),
    revokeInvite: (token: string) =>
      request<StatusResponse>('DELETE', `/invites/${encodeURIComponent(token)}`),
    /** Host only: stop (or allow) new people joining by code or link. */
    setLobbyLocked: (pickId: string, locked: boolean) =>
      request<{ locked: boolean }>('POST', `${pickPath(pickId)}/lock`, { body: { locked } }),
    blockUser: (userId: string) =>
      request<StatusResponse>('POST', `/blocks/${encodeURIComponent(userId)}`),
    unblockUser: (userId: string) =>
      request<StatusResponse>('POST', `/blocks/${encodeURIComponent(userId)}/remove`),
    /** 10 a day; 404 for anything I can't see. */
    report: (input: { kind: 'user' | 'pick' | 'group'; targetId: string; reason: string }) =>
      request<StatusResponse>('POST', '/reports', { body: input }),
    submitSwipe: (pickId: string, placeId: string, value: PreferenceValue) =>
      request<StatusResponse>('POST', `${pickPath(pickId)}/swipes`, { body: { placeId, value } }),
    /** Host only: closes swiping and ranks. Others get 403 FORBIDDEN. */
    rankPick: (pickId: string) => request<RankResponse>('POST', `${pickPath(pickId)}/rank`),

    /** The Pick, my candidates in my own shuffled order, and my answers. */
    getPick: async (pickId: string): Promise<PickDetail> => {
      return pickDetailFromApi(await request<RawPickDetail>('GET', pickPath(pickId)));
    },
    /** Who's in and who's done (never what anyone answered). The Realtime fallback polls this. */
    getProgress: (pickId: string) => request<PickProgress>('GET', `${pickPath(pickId)}/progress`),
    /** Host only: draft -> swiping. Needs at least 2 participants. */
    startPick: (pickId: string) =>
      request<{ state: PickState; candidateCount: number }>('POST', `${pickPath(pickId)}/start`),
    /**
     * Host only: a new pool. After anyone has swiped the server answers 409 CONFIRM_REQUIRED
     * unless `confirm` is true, because it clears everyone's answers.
     */
    refreshPick: (pickId: string, confirm = false) =>
      request<{ candidateCount: number }>('POST', `${pickPath(pickId)}/refresh`, {
        body: { confirm },
      }),
    /** Host only. The reason (optional, up to 200 characters) shows in everyone's inbox. */
    cancelPick: (pickId: string, reason?: string) =>
      request<{ state: PickState }>('POST', `${pickPath(pickId)}/cancel`, {
        body: reason?.trim() ? { reason: reason.trim() } : undefined,
      }),
    /** Host only: close swiping now (rank -> clear winner or final vote). */
    closePick: (pickId: string) => request<CloseResponse>('POST', `${pickPath(pickId)}/close`),
    /** One changeable ballot among the finalists, while the Pick is in final_vote. */
    vote: (pickId: string, placeId: string) =>
      request<StatusResponse>('POST', `${pickPath(pickId)}/vote`, { body: { placeId } }),
    /** Host only: tally now, before everyone has voted. */
    closeVote: (pickId: string) =>
      request<StatusResponse>('POST', `${pickPath(pickId)}/close-vote`),

    /** My friends, requests to me, and requests I sent (names only, never emails). */
    listFriends: () => request<FriendsList>('GET', '/friends'),
    /**
     * Ask someone by the exact email they sign in with. Always { status: 'sent' }, so this can't
     * reveal who has an account; if they already asked you, you're now friends. 400
     * CANNOT_FRIEND_SELF for your own email, 429 RATE_LIMITED after 20 a day.
     */
    addFriend: (email: string) =>
      request<{ status: 'sent' }>('POST', '/friends/requests', { body: { email } }),
    /** Accept their request. 404 REQUEST_NOT_FOUND if it was withdrawn. */
    acceptFriend: (userId: string) =>
      request<{ status: 'accepted' }>('POST', `/friends/${encodeURIComponent(userId)}/accept`),
    /** Decline their request, cancel mine, or unfriend. Idempotent. */
    removeFriend: (userId: string) =>
      request<StatusResponse>('POST', `/friends/${encodeURIComponent(userId)}/remove`),
    /** My newest 50 notifications (the inbox) and how many are unread. */
    listNotifications: () =>
      request<{ notifications: NotificationRow[]; unreadCount: number }>('GET', '/notifications'),
    markNotificationRead: (id: string) =>
      request<StatusResponse>('POST', `/notifications/${encodeURIComponent(id)}/read`),

    // After the winner (Alan): plan time, RSVP, "Did you go?", reasons, history, Pick again.
    /** Plan time, RSVP and outcome counts (never who said what), plus my own answers. */
    getPlan: (pickId: string) => request<PlanSummary>('GET', `${pickPath(pickId)}/plan`),
    /** One plain-language sentence per finalist, once the Pick has closed. No numbers. */
    getReasons: (pickId: string) =>
      request<{ reasons: { placeId: string; rank: number; reason: string }[] }>(
        'GET',
        `${pickPath(pickId)}/reasons`,
      ),
    /** Host only, completed Picks: when the group is going. Must be within 30 days. */
    setPlanTime: (pickId: string, planAt: string) =>
      request<{ planAt: string }>('POST', `${pickPath(pickId)}/plan-time`, { body: { planAt } }),
    rsvp: (pickId: string, status: RsvpStatus) =>
      request<StatusResponse>('POST', `${pickPath(pickId)}/rsvp`, { body: { status } }),
    /** "Did you go?" (and optionally "would you go again?"). Changeable. */
    recordOutcome: (pickId: string, went: boolean, again: boolean | null = null) =>
      request<StatusResponse>('POST', `${pickPath(pickId)}/outcome`, { body: { went, again } }),
    /** A new draft with the same people and settings; I host it. */
    pickAgain: (pickId: string) => request<CreatePickResponse>('POST', `${pickPath(pickId)}/again`),
    /** Completed Picks I was in, newest first; with a group id, that group's. */
    getHistory: (groupId?: string) =>
      request<{ picks: HistoryItem[] }>(
        'GET',
        groupId ? `/groups/${encodeURIComponent(groupId)}/history` : '/history',
      ),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

export const api: ApiClient = createApiClient(
  USE_MOCK
    ? { baseUrl: MOCK_API_BASE_URL, getAccessToken, fetch: mockFetch }
    : { baseUrl: API_BASE_URL, getAccessToken, fetch: (url, init) => fetch(url, init) },
);
