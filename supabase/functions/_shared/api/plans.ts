// After the winner (Alan, M4): plan time, RSVP, "Did you go?", history, "Pick again" and the
// FR-14 reasons. Who may do what is rechecked inside each RPC (0013_plans_rsvp.sql); this
// layer validates input and sends notifications. Contract: docs/api-integration.md.

import { ApiError } from './errors.ts';
import type { Notifier } from './notify.ts';
import { explainRank, type FinalistCounts } from '../domain/explainRank.ts';

export type RsvpStatus = 'going' | 'maybe' | 'not_going';
const RSVP_STATUSES: readonly RsvpStatus[] = ['going', 'maybe', 'not_going'];

export interface PlanSummary {
  state: string;
  isHost: boolean;
  planAt: string | null;
  participantCount: number;
  rsvps: { going: number; maybe: number; notGoing: number };
  myRsvp: RsvpStatus | null;
  outcomes: { went: number; didNotGo: number; again: number };
  myOutcome: { went: boolean; again: boolean | null } | null;
}

export interface HistoryItem {
  id: string;
  category: string;
  decidedAt: string;
  decidedBy: string;
  planAt: string | null;
  groupId: string | null;
  winner: { placeId: string; name: string | null } | null;
  /** Top three by rank. Never scores, never anyone's answers. */
  finalists: { placeId: string; rank: number; name: string | null }[];
  participants: { userId: string; displayName: string | null }[];
  wentCount: number;
}

/** Database adapter (service role); every RPC rechecks membership/host/state itself. */
export interface PlansStore {
  /** Returns everyone else in the Pick. */
  setPlanTime(pickId: string, userId: string, planAt: string): Promise<string[]>;
  rsvp(pickId: string, userId: string, status: RsvpStatus): Promise<void>;
  outcome(pickId: string, userId: string, went: boolean, again: boolean | null): Promise<void>;
  loadPlan(pickId: string, userId: string): Promise<PlanSummary>;
  history(userId: string, groupId: string | null): Promise<HistoryItem[]>;
  again(pickId: string, userId: string): Promise<{ id: string; addedUserIds: string[] }>;
  finalistCounts(pickId: string, userId: string): Promise<(FinalistCounts & { placeId: string })[]>;
  notifier?: Notifier;
}

/** A plan can be set from now up to 30 days out. */
export const MAX_PLAN_LEAD_MS = 30 * 24 * 60 * 60_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asObject(body: unknown, what: string): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ApiError(400, 'INVALID_INPUT', `Expected ${what}`);
  }
  return body as Record<string, unknown>;
}

export function parsePlanTime(body: unknown, now: number = Date.now()): string {
  const { planAt } = asObject(body, 'a plan time object');
  const at = typeof planAt === 'string' ? Date.parse(planAt) : NaN;
  if (Number.isNaN(at)) throw new ApiError(400, 'INVALID_INPUT', 'planAt must be a date');
  if (at < now) throw new ApiError(400, 'INVALID_INPUT', 'planAt must be in the future');
  if (at - now > MAX_PLAN_LEAD_MS) {
    throw new ApiError(400, 'INVALID_INPUT', 'planAt must be within 30 days');
  }
  return new Date(at).toISOString();
}

export function parseRsvp(body: unknown): RsvpStatus {
  const { status } = asObject(body, 'an RSVP object');
  if (!RSVP_STATUSES.includes(status as RsvpStatus)) {
    throw new ApiError(400, 'INVALID_INPUT', 'status must be going, maybe or not_going');
  }
  return status as RsvpStatus;
}

export function parseOutcome(body: unknown): { went: boolean; again: boolean | null } {
  const { went, again } = asObject(body, 'an outcome object');
  if (typeof went !== 'boolean') {
    throw new ApiError(400, 'INVALID_INPUT', 'went must be true or false');
  }
  if (again !== undefined && again !== null && typeof again !== 'boolean') {
    throw new ApiError(400, 'INVALID_INPUT', 'again must be true, false or null');
  }
  return { went, again: typeof again === 'boolean' ? again : null };
}

/** POST /picks/:id/plan-time { planAt }: host only, once there's a winner. */
export async function setPlanTime(
  store: PlansStore,
  pickId: string,
  userId: string,
  body: unknown,
) {
  const planAt = parsePlanTime(body);
  const others = await store.setPlanTime(pickId, userId, planAt);
  await store.notifier?.(others, 'plan_time_set', pickId);
  return { planAt };
}

/** POST /picks/:id/rsvp { status }. */
export async function rsvp(store: PlansStore, pickId: string, userId: string, body: unknown) {
  await store.rsvp(pickId, userId, parseRsvp(body));
  return { status: 'ok' as const };
}

/** POST /picks/:id/outcome { went, again? }: "Did you go?". */
export async function recordOutcome(
  store: PlansStore,
  pickId: string,
  userId: string,
  body: unknown,
) {
  const { went, again } = parseOutcome(body);
  await store.outcome(pickId, userId, went, again);
  return { status: 'ok' as const };
}

/** GET /picks/:id/plan: time, RSVP counts, outcome counts, and my own answers. */
export function getPlan(store: PlansStore, pickId: string, userId: string) {
  return store.loadPlan(pickId, userId);
}

/** GET /history and GET /groups/:id/history. */
export async function getHistory(store: PlansStore, userId: string, groupId: string | null = null) {
  if (groupId !== null && !UUID_RE.test(groupId)) {
    throw new ApiError(404, 'GROUP_NOT_FOUND', 'Group not found');
  }
  return { picks: await store.history(userId, groupId) };
}

/** POST /picks/:id/again: host only; a new draft with the same people and settings. */
export async function pickAgain(store: PlansStore, pickId: string, userId: string) {
  const { id, addedUserIds } = await store.again(pickId, userId);
  await store.notifier?.(addedUserIds, 'added_to_pick', id);
  return { pickId: id, state: 'draft' as const };
}

/** GET /picks/:id/reasons: one sentence per finalist, words only. */
export async function getReasons(store: PlansStore, pickId: string, userId: string) {
  const rows = await store.finalistCounts(pickId, userId);
  return {
    reasons: rows.map((r) => ({ placeId: r.placeId, rank: r.rank, reason: explainRank(r) })),
  };
}
