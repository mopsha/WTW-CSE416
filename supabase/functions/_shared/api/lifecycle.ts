// Pick lifecycle: create, start, refresh, cancel, read. Spec: docs/design.md
// (owner: Alan). The API is the only writer of picks.state; every transition
// goes through canTransition.

import { priorityCandidates } from '../domain/candidatePriority.ts';
import { ApiError } from './errors.ts';
import { requireCleanText } from './text.ts';
import type { Notifier } from './notify.ts';
import { canTransition, type PickState } from '../domain/pickState.ts';
import { shuffleForUser } from '../domain/shuffle.ts';
import type { LatLng } from '../domain/geo.ts';
import { candidateSnapshot, NoCandidatesError, type PoolBuilder } from '../places/pool.ts';
import { validFilters, type PlaceFilters } from '../domain/placeFilters.ts';
import type { HoursMetadata } from '../places/refreshOpenHours.ts';
import type { Candidate } from '../places/types.ts';
import type { PickCategory } from '../domain/createPick.ts';
import { planProblem, type PlanOptions, type StoredCustomOption } from '../domain/customPlans.ts';
import { distanceMeters } from '../domain/geo.ts';
import { matchesFilters } from '../domain/placeFilters.ts';

// Limits mirror Mike's validateCreatePick (_shared/domain/createPick.ts, PR #11, not yet
// merged): once that lands, replace this parser with his shared validateCreatePick so the
// app and API check the same function instead of two copies of the same limits.
const CATEGORIES: readonly PickCategory[] = ['food', 'activities', 'custom'];
export const MIN_RADIUS_M = 200;
export const MAX_RADIUS_M = 50_000;
export const MIN_POOL_SIZE = 5;
export const MAX_POOL_SIZE = 30;
export const DEFAULT_POOL_SIZE = 20;
export const MIN_CLOSE_THRESHOLD = 1;
export const MAX_CLOSE_THRESHOLD = 100;
export const DEFAULT_CLOSE_THRESHOLD = 100;
export const MIN_DEADLINE_LEAD_MS = 5 * 60_000;
export const MAX_DEADLINE_LEAD_MS = 7 * 24 * 60 * 60_000;
export const MIN_PARTICIPANTS_TO_START = 2;

export interface CreatePickInput extends PlaceFilters, PlanOptions {
  category: PickCategory;
  center: LatLng;
  radiusM: number;
  poolSize: number;
  closeThreshold: number;
  deadlineAt: string | null;
}

export interface CandidateSnapshot {
  placeId: string;
  /** Frozen place data shown during this Pick; must include numeric lat/lng. */
  snapshot: object;
}

export interface LifecyclePick extends PlaceFilters {
  id: string;
  /** Null once the host deleted their account (0017); such a Pick is completed or canceled. */
  hostId: string | null;
  includeSaved?: boolean;
  customOptions?: StoredCustomOption[];
  mixCategory?: 'food' | 'activities';
  state: PickState;
  category: PickCategory;
  center: LatLng;
  radiusM: number;
  poolSize: number;
  deadlineAt: string | null;
  closeThreshold: number;
  participantIds: string[];
  candidates: CandidateSnapshot[];
  /** Whether anyone has swiped yet; gates a confirm-required refresh. */
  hasAnswers: boolean;
  myAnswers: Record<string, 0 | 1 | 2>;
  winnerPlaceId: string | null;
  decidedAt: string | null;
  decidedBy: 'clear_winner' | 'vote' | 'tie_break' | null;
  version: string;
}

/** Database adapter; mutations must recheck authorization/state atomically. */
export interface LifecycleStore {
  createPick(hostId: string, input: CreatePickInput): Promise<{ id: string }>;
  load(pickId: string, userId: string): Promise<LifecyclePick | null>;
  start(pickId: string, userId: string, candidates: CandidateSnapshot[]): Promise<void>;
  refresh(pickId: string, userId: string, candidates: CandidateSnapshot[]): Promise<void>;
  cancel(pickId: string, userId: string, reason: string | null): Promise<void>;
  savedCandidates?(hostId: string): Promise<Candidate[]>;
  /** Tells the other participants when the host starts or cancels. Optional in tests. */
  notifier?: Notifier;
}

/**
 * Validate POST /picks's body: { category, center: {lat, lng}, radiusM, poolSize,
 * deadlineAt, closeThreshold } — Mike's contract (docs/api-integration.md), not the
 * snake_case placeholder this file started with. `now` is injectable for tests.
 */
export function parseCreatePick(body: unknown, now: number = Date.now()): CreatePickInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ApiError(400, 'INVALID_INPUT', 'Expected a Pick object');
  }
  const b = body as Record<string, unknown>;
  if (typeof b.category !== 'string' || !CATEGORIES.includes(b.category as PickCategory)) {
    throw new ApiError(400, 'INVALID_INPUT', 'category must be food, activities or custom');
  }
  const center = b.center as Partial<LatLng> | undefined;
  if (
    typeof center !== 'object' ||
    center === null ||
    typeof center.lat !== 'number' ||
    !Number.isFinite(center.lat) ||
    Math.abs(center.lat) > 90 ||
    typeof center.lng !== 'number' ||
    !Number.isFinite(center.lng) ||
    Math.abs(center.lng) > 180
  ) {
    throw new ApiError(400, 'INVALID_INPUT', 'center.lat/center.lng must be valid coordinates');
  }
  const radiusM = b.radiusM;
  if (
    typeof radiusM !== 'number' ||
    !Number.isInteger(radiusM) ||
    radiusM < MIN_RADIUS_M ||
    radiusM > MAX_RADIUS_M
  ) {
    throw new ApiError(
      400,
      'INVALID_INPUT',
      `radiusM must be between ${MIN_RADIUS_M} and ${MAX_RADIUS_M}`,
    );
  }
  const planError = planProblem(b);
  if (planError) throw new ApiError(400, 'INVALID_INPUT', planError);
  for (const option of (b.customOptions ?? []) as { name: string; note?: string }[]) {
    requireCleanText(option.name, 'option');
    if (option.note) requireCleanText(option.note, 'note');
  }
  const poolSize =
    b.poolSize ??
    (b.category === 'custom' && !b.mixCategory && !b.includeSaved
      ? (b.customOptions as unknown[]).length
      : DEFAULT_POOL_SIZE);
  if (
    typeof poolSize !== 'number' ||
    !Number.isInteger(poolSize) ||
    poolSize < (b.category === 'custom' ? 2 : MIN_POOL_SIZE) ||
    poolSize > MAX_POOL_SIZE
  ) {
    throw new ApiError(
      400,
      'INVALID_INPUT',
      `poolSize must be between ${b.category === 'custom' ? 2 : MIN_POOL_SIZE} and ${MAX_POOL_SIZE}`,
    );
  }
  if (Array.isArray(b.customOptions) && poolSize < b.customOptions.length)
    throw new ApiError(400, 'INVALID_INPUT', 'Pool must fit all typed options');
  const closeThreshold = b.closeThreshold ?? DEFAULT_CLOSE_THRESHOLD;
  if (
    typeof closeThreshold !== 'number' ||
    !Number.isInteger(closeThreshold) ||
    closeThreshold < MIN_CLOSE_THRESHOLD ||
    closeThreshold > MAX_CLOSE_THRESHOLD
  ) {
    throw new ApiError(
      400,
      'INVALID_INPUT',
      `closeThreshold must be between ${MIN_CLOSE_THRESHOLD} and ${MAX_CLOSE_THRESHOLD}`,
    );
  }
  let deadlineAt: string | null = null;
  if (b.deadlineAt !== undefined && b.deadlineAt !== null) {
    const at = typeof b.deadlineAt === 'string' ? Date.parse(b.deadlineAt) : NaN;
    if (Number.isNaN(at)) {
      throw new ApiError(400, 'INVALID_INPUT', 'deadlineAt must be a date, or null');
    }
    if (at - now < MIN_DEADLINE_LEAD_MS) {
      throw new ApiError(400, 'INVALID_INPUT', 'deadlineAt must give people at least 5 minutes');
    }
    if (at - now > MAX_DEADLINE_LEAD_MS) {
      throw new ApiError(400, 'INVALID_INPUT', 'deadlineAt must be within a week');
    }
    deadlineAt = new Date(at).toISOString();
  }
  if (!validFilters(b as PlaceFilters))
    throw new ApiError(400, 'INVALID_INPUT', 'Invalid priceMax or openNow');
  return {
    ...(b.includeSaved !== undefined ? { includeSaved: b.includeSaved as boolean } : {}),
    ...(b.customOptions !== undefined
      ? { customOptions: b.customOptions as PlanOptions['customOptions'] }
      : {}),
    ...(b.mixCategory !== undefined
      ? { mixCategory: b.mixCategory as PlanOptions['mixCategory'] }
      : {}),
    priceMax: b.priceMax as number | null | undefined,
    openNow: b.openNow as boolean | undefined,
    category: b.category as PickCategory,
    center: { lat: center.lat, lng: center.lng },
    radiusM,
    poolSize,
    closeThreshold,
    deadlineAt,
  };
}

export function parseRefreshBody(body: unknown): boolean {
  if (body === undefined || body === null) return false;
  if (typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(400, 'INVALID_INPUT', 'Expected an object with an optional confirm flag');
  }
  const { confirm } = body as Record<string, unknown>;
  if (confirm === undefined) return false;
  if (typeof confirm !== 'boolean') {
    throw new ApiError(400, 'INVALID_INPUT', 'confirm must be a boolean');
  }
  return confirm;
}

export async function createPick(store: LifecycleStore, hostId: string, body: unknown) {
  const input = parseCreatePick(body);
  const { id } = await store.createPick(hostId, input);
  return { pickId: id, state: 'draft' as const };
}

async function loadAsParticipant(store: LifecycleStore, pickId: string, userId: string) {
  const pick = await store.load(pickId, userId);
  if (!pick) throw new ApiError(404, 'PICK_NOT_FOUND', 'Pick not found');
  if (!pick.participantIds.includes(userId)) {
    throw new ApiError(403, 'FORBIDDEN', 'You must be a participant in this Pick');
  }
  return pick;
}

function requireHost(pick: LifecyclePick, userId: string) {
  if (pick.hostId !== userId) throw new ApiError(403, 'FORBIDDEN', 'Only the host can do this');
}

async function buildCandidates(
  pool: PoolBuilder,
  pick: LifecyclePick,
  store: LifecycleStore,
): Promise<CandidateSnapshot[]> {
  const priority: Candidate[] = [...(pick.customOptions ?? [])];
  if (pick.includeSaved && pick.hostId) {
    if (!store.savedCandidates)
      throw new ApiError(503, 'SAVED_PLACES_UNAVAILABLE', 'Saved place resolution is unavailable');
    const saved = await store.savedCandidates(pick.hostId);
    priority.push(
      ...saved.filter(
        (p) =>
          (p.provider !== 'custom' || p.locationProvided === true) &&
          distanceMeters(pick.center, p) <= pick.radiusM &&
          matchesFilters(p, pick, new Date()),
      ),
    );
  }
  let candidates = priorityCandidates(priority, [], pick.poolSize);
  const category = pick.category === 'custom' ? pick.mixCategory : pick.category;
  if (category && candidates.length < pick.poolSize) {
    try {
      const found = await pool.buildPool({
        center: pick.center,
        radiusM: pick.radiusM,
        category,
        poolSize: priority.length ? 30 : pick.poolSize,
        priceMax: pick.priceMax,
        openNow: pick.openNow,
      });
      candidates = priorityCandidates(priority, found, pick.poolSize);
    } catch (error) {
      if (!(error instanceof NoCandidatesError)) throw error;
    }
  }
  if (!candidates.length) throw new ApiError(409, 'NO_CANDIDATES', 'No places found for this Pick');
  return candidates.map((c) => ({ placeId: c.placeId, snapshot: candidateSnapshot(c) }));
}

export async function startPick(
  store: LifecycleStore,
  pool: PoolBuilder,
  pickId: string,
  userId: string,
  beforeBuild?: () => Promise<void>,
) {
  const pick = await loadAsParticipant(store, pickId, userId);
  requireHost(pick, userId);
  if (!canTransition(pick.state, 'swiping', 'host')) {
    throw new ApiError(409, 'INVALID_PICK_STATE', 'Pick must be draft to start');
  }
  if (pick.participantIds.length < MIN_PARTICIPANTS_TO_START) {
    throw new ApiError(
      409,
      'NOT_ENOUGH_PARTICIPANTS',
      `A Pick needs at least ${MIN_PARTICIPANTS_TO_START} participants to start`,
    );
  }
  await beforeBuild?.();
  const candidates = await buildCandidates(pool, pick, store);
  await store.start(pickId, userId, candidates);
  await store.notifier?.(othersThan(pick, userId), 'pick_started', pickId);
  return { state: 'swiping' as const, candidateCount: candidates.length };
}

export async function refreshPick(
  store: LifecycleStore,
  pool: PoolBuilder,
  pickId: string,
  userId: string,
  body: unknown,
  beforeBuild?: () => Promise<void>,
) {
  const confirm = parseRefreshBody(body);
  const pick = await loadAsParticipant(store, pickId, userId);
  requireHost(pick, userId);
  if (pick.state !== 'draft' && pick.state !== 'swiping') {
    throw new ApiError(409, 'INVALID_PICK_STATE', 'Pick must be draft or swiping to refresh');
  }
  if (pick.hasAnswers && !confirm) {
    throw new ApiError(
      409,
      'CONFIRM_REQUIRED',
      "Refreshing now clears everyone's answers; pass confirm:true",
    );
  }
  await beforeBuild?.();
  const candidates = await buildCandidates(pool, pick, store);
  await store.refresh(pickId, userId, candidates);
  return { candidateCount: candidates.length };
}

export const MAX_CANCEL_REASON = 200;

/** POST /picks/:id/cancel body: nothing, or { reason } (trimmed, up to 200 characters). */
export function parseCancelBody(body: unknown): string | null {
  if (body === undefined || body === null) return null;
  if (typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(400, 'INVALID_INPUT', 'Expected an object with an optional reason');
  }
  const { reason } = body as Record<string, unknown>;
  if (reason === undefined || reason === null) return null;
  if (typeof reason !== 'string' || reason.trim().length > MAX_CANCEL_REASON) {
    throw new ApiError(
      400,
      'INVALID_INPUT',
      `reason must be text of at most ${MAX_CANCEL_REASON} characters`,
    );
  }
  if (/[\u0000-\u001f\u007f]/.test(reason)) {
    throw new ApiError(400, 'INVALID_INPUT', 'reason must be one line of text');
  }
  const trimmed = reason.trim();
  // Shown in other people's inboxes, so it goes through the same filter as names.
  if (trimmed) requireCleanText(trimmed, 'reason');
  return trimmed || null;
}

function othersThan(pick: LifecyclePick, userId: string) {
  return pick.participantIds.filter((id) => id !== userId);
}

export async function cancelPick(
  store: LifecycleStore,
  pickId: string,
  userId: string,
  body?: unknown,
) {
  const reason = parseCancelBody(body);
  const pick = await loadAsParticipant(store, pickId, userId);
  requireHost(pick, userId);
  if (!canTransition(pick.state, 'canceled', 'host')) {
    throw new ApiError(409, 'INVALID_PICK_STATE', 'This Pick can no longer be canceled');
  }
  await store.cancel(pickId, userId, reason);
  // The reason is shown in the inbox only; push text stays generic.
  await store.notifier?.(
    othersThan(pick, userId),
    'pick_canceled',
    pickId,
    reason ? { reason } : {},
  );
  return { state: 'canceled' as const };
}

export async function getPick(
  store: LifecycleStore,
  pickId: string,
  userId: string,
  refreshHours?: (candidates: CandidateSnapshot[]) => Promise<HoursMetadata[]>,
) {
  const pick = await loadAsParticipant(store, pickId, userId);
  // Membership is checked before any provider access. Metadata never changes snapshots.
  let candidateHours: HoursMetadata[] = [];
  if (refreshHours && (pick.state === 'completed' || pick.state === 'final_vote')) {
    try {
      candidateHours = await refreshHours(pick.candidates);
    } catch {
      /* Optional metadata only. */
    }
  }
  const order = shuffleForUser(
    pick.candidates.map((c) => c.placeId),
    pick.id,
    userId,
  );
  const byId = new Map(pick.candidates.map((c) => [c.placeId, c.snapshot]));
  return {
    id: pick.id,
    state: pick.state,
    category: pick.category,
    center: pick.center,
    radiusM: pick.radiusM,
    poolSize: pick.poolSize,
    priceMax: pick.priceMax,
    openNow: pick.openNow,
    deadlineAt: pick.deadlineAt,
    closeThreshold: pick.closeThreshold,
    isHost: pick.hostId === userId,
    hostDeleted: pick.hostId === null,
    participantCount: pick.participantIds.length,
    candidates: order.map((placeId) => byId.get(placeId)),
    ...(refreshHours ? { candidateHours } : {}),
    myAnswers: pick.myAnswers,
    winnerPlaceId: pick.winnerPlaceId,
    decidedAt: pick.decidedAt,
    decidedBy: pick.decidedBy,
  };
}
