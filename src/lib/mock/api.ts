// A fake `fetch` for our Edge Function. It mirrors the API contract (docs/api-integration.md):
// same routes, status codes, error codes and response shapes, returned as real Response
// objects, so src/lib/api.ts runs the exact same parsing and error handling in both modes.
import type { NotificationRow } from '@shared/api/notify.ts';
import type { HistoryItem, PlanSummary, RsvpStatus } from '@shared/api/plans.ts';
import { explainRank } from '@shared/domain/explainRank.ts';
import { validateCreatePick, type CreatePickInput } from '@shared/domain/createPick.ts';
import { parseJoinCode } from '@shared/domain/joinCode.ts';

import { MOCK_FAIL_RATE } from '../config';
import type { PreferenceValue } from '../types';
import { MOCK_ACCESS_TOKEN, MOCK_USER_ID } from './auth';
import { MOCK_PLACES } from './fixtures';
import {
  createMockPick,
  decide,
  emit,
  finalistsOf,
  joinMockPick,
  maybeAutoClose,
  maybeSettleVote,
  mockPicks,
  progressOf,
  scheduleBots,
  settleVote,
  touch,
  type MockPick,
} from './store';

export const MOCK_API_BASE_URL = 'https://mock.wtw.local/functions/v1/api';

/** A seeded inbox for the fixture Picks, so the inbox has something to show in mock mode. */
export const mockNotifications: NotificationRow[] = [
  {
    id: 'mock-n-vote',
    type: 'vote_needed',
    pickId: 'vote-pick',
    payload: {},
    createdAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    readAt: null,
  },
  {
    id: 'mock-n-done',
    type: 'winner_decided',
    pickId: 'done-pick',
    payload: {},
    createdAt: new Date(Date.now() - 6 * 86_400_000).toISOString(),
    readAt: new Date(Date.now() - 6 * 86_400_000).toISOString(),
  },
];

const LATENCY_MS = process.env.NODE_ENV === 'test' ? 0 : 300;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const fail = (status: number, code: string, message: string) =>
  json(status, { error: { code, message } });

function isPreferenceValue(v: unknown): v is PreferenceValue {
  return v === 0 || v === 1 || v === 2;
}

function readBody(init: RequestInit): unknown {
  if (init.body === undefined || init.body === null) return null;
  try {
    return JSON.parse(typeof init.body === 'string' ? init.body : '');
  } catch {
    return undefined;
  }
}

/** POST /picks: a new draft Pick hosted by me. The mock pool is the fixture places. */
function createPick(body: unknown): Response {
  if (body === undefined || body === null) {
    return fail(400, 'INVALID_JSON', 'Request body must be valid JSON');
  }
  const problems = validateCreatePick(body);
  if (problems.length > 0) {
    return fail(400, 'INVALID_INPUT', problems.map((p) => p.message).join(' '));
  }
  const pick = createMockPick(body as CreatePickInput);
  scheduleBots(pick);
  return json(201, { pickId: pick.id, state: 'draft' });
}

/** POST /picks/join: same validation and errors as the API (try MOCK_INVITE_CODE). */
function joinPick(body: unknown): Response {
  if (body === undefined) return fail(400, 'INVALID_JSON', 'Request body must be valid JSON');
  const raw = (body as { code?: unknown } | null)?.code;
  const code = typeof raw === 'string' && raw.length <= 64 ? parseJoinCode(raw) : null;
  if (!code) return fail(400, 'INVALID_INPUT', 'Expected a 6-character join code');
  const result = joinMockPick(code);
  if (result === 'not_found') {
    return fail(404, 'JOIN_CODE_NOT_FOUND', 'That code is not valid or has expired');
  }
  if (result === 'closed') {
    return fail(409, 'PICK_CLOSED', 'This Pick is no longer accepting people');
  }
  return json(200, result);
}

function getPick(pick: MockPick) {
  const mine = pick.participants.find((p) => p.userId === MOCK_USER_ID);
  return {
    id: pick.id,
    state: pick.state,
    category: pick.category,
    center: pick.center,
    radiusM: pick.radiusM,
    poolSize: pick.poolSize,
    deadlineAt: pick.deadlineAt,
    closeThreshold: pick.closeThreshold,
    isHost: pick.hostId === MOCK_USER_ID,
    participantCount: pick.participants.length,
    candidates: pick.candidates.map((c) => ({ ...c })),
    myAnswers: Object.fromEntries(mine?.answers ?? []),
    winnerPlaceId: pick.winnerPlaceId,
    decidedAt: pick.decidedAt,
    decidedBy: pick.decidedBy,
  };
}

// Plan time, RSVPs and "Did you go?" per Pick (the real API keeps these in 0013's tables).
interface MockPlan {
  planAt: string | null;
  rsvps: Map<string, RsvpStatus>;
  outcomes: Map<string, { went: boolean; again: boolean | null }>;
}
const mockPlans = new Map<string, MockPlan>();
function plans(pick: MockPick): MockPlan {
  let plan = mockPlans.get(pick.id);
  if (!plan) {
    plan = { planAt: null, rsvps: new Map(), outcomes: new Map() };
    mockPlans.set(pick.id, plan);
  }
  return plan;
}

function planOf(pick: MockPick): PlanSummary {
  const plan = plans(pick);
  const rsvps = [...plan.rsvps.values()];
  const outcomes = [...plan.outcomes.values()];
  return {
    state: pick.state,
    isHost: pick.hostId === MOCK_USER_ID,
    planAt: plan.planAt,
    participantCount: pick.participants.length,
    rsvps: {
      going: rsvps.filter((s) => s === 'going').length,
      maybe: rsvps.filter((s) => s === 'maybe').length,
      notGoing: rsvps.filter((s) => s === 'not_going').length,
    },
    myRsvp: plan.rsvps.get(MOCK_USER_ID) ?? null,
    outcomes: {
      went: outcomes.filter((o) => o.went).length,
      didNotGo: outcomes.filter((o) => !o.went).length,
      again: outcomes.filter((o) => o.again).length,
    },
    myOutcome: plan.outcomes.get(MOCK_USER_ID) ?? null,
  };
}

/** GET /history: completed Picks I'm in, newest first (same shape as pick_history). */
function historyOf(): HistoryItem[] {
  const name = (pick: MockPick, placeId: string | null) =>
    pick.candidates.find((c) => c.placeId === placeId)?.name ?? null;
  return [...mockPicks.values()]
    .filter((p) => p.state === 'completed' && p.participants.some((x) => x.userId === MOCK_USER_ID))
    .sort((a, b) => (b.decidedAt ?? '').localeCompare(a.decidedAt ?? ''))
    .map((p) => ({
      id: p.id,
      category: p.category,
      decidedAt: p.decidedAt ?? new Date(0).toISOString(),
      decidedBy: p.decidedBy ?? 'clear_winner',
      planAt: plans(p).planAt,
      groupId: null,
      winner: p.winnerPlaceId ? { placeId: p.winnerPlaceId, name: name(p, p.winnerPlaceId) } : null,
      finalists: p.ranking
        .filter((r) => r.rank <= 3)
        .sort((a, b) => a.rank - b.rank)
        .map((r) => ({ placeId: r.placeId, rank: r.rank, name: name(p, r.placeId) })),
      participants: p.participants.map((x) => ({ userId: x.userId, displayName: x.name })),
      wentCount: [...plans(p).outcomes.values()].filter((o) => o.went).length,
    }));
}

type Handler = (pick: MockPick, body: unknown) => Response;

const hostOnly =
  (fn: Handler): Handler =>
  (pick, body) =>
    pick.hostId === MOCK_USER_ID
      ? fn(pick, body)
      : fail(403, 'FORBIDDEN', 'Only the host can do this');

const wrongState = (what: string) => fail(409, 'INVALID_PICK_STATE', what);

const ROUTES: Record<string, Handler> = {
  'GET ': (pick) => json(200, getPick(pick)),
  'GET progress': (pick) => json(200, progressOf(pick)),

  'POST start': hostOnly((pick) => {
    if (pick.state !== 'draft') return wrongState('Pick must be draft to start');
    if (pick.participants.length < 2) {
      return fail(409, 'NOT_ENOUGH_PARTICIPANTS', 'A Pick needs at least 2 participants to start');
    }
    pick.candidates = MOCK_PLACES.slice(0, pick.poolSize);
    pick.state = 'swiping';
    emit(pick.id);
    scheduleBots(pick);
    return json(200, { state: 'swiping', candidateCount: pick.candidates.length });
  }),

  'POST refresh': hostOnly((pick, body) => {
    if (pick.state !== 'draft' && pick.state !== 'swiping') {
      return wrongState('Pick must be draft or swiping to refresh');
    }
    const confirm =
      typeof body === 'object' && body !== null && 'confirm' in body && body.confirm === true;
    const hasAnswers = pick.participants.some((p) => p.answers.size > 0);
    if (hasAnswers && !confirm) {
      return fail(
        409,
        'CONFIRM_REQUIRED',
        "Refreshing now clears everyone's answers; pass confirm:true",
      );
    }
    // A "new" pool: the same places, rotated, so the deck visibly changes.
    const shift = Math.floor(MOCK_PLACES.length / 3);
    const rotated = [...MOCK_PLACES.slice(shift), ...MOCK_PLACES.slice(0, shift)];
    if (pick.state === 'swiping') pick.candidates = rotated.slice(0, pick.poolSize);
    pick.participants.forEach((p) => p.answers.clear());
    emit(pick.id);
    return json(200, { candidateCount: pick.state === 'swiping' ? pick.candidates.length : 0 });
  }),

  'POST cancel': hostOnly((pick, body) => {
    const reason =
      typeof body === 'object' && body !== null && 'reason' in body ? body.reason : undefined;
    if (reason !== undefined && (typeof reason !== 'string' || reason.trim().length > 200)) {
      return fail(400, 'INVALID_INPUT', 'reason must be text of at most 200 characters');
    }
    if (pick.state === 'completed' || pick.state === 'canceled') {
      return wrongState('This Pick can no longer be canceled');
    }
    pick.state = 'canceled';
    emit(pick.id);
    return json(200, { state: 'canceled' });
  }),

  'POST swipes': (pick, body) => {
    if (pick.state !== 'swiping') return wrongState('Pick must be swiping');
    if (body === undefined) return fail(400, 'INVALID_JSON', 'Request body must be valid JSON');
    const { placeId, value } = (typeof body === 'object' && body !== null ? body : {}) as Record<
      string,
      unknown
    >;
    if (typeof placeId !== 'string' || !placeId.trim() || !isPreferenceValue(value)) {
      return fail(400, 'INVALID_INPUT', 'Expected placeId and value 0, 1, or 2');
    }
    if (!pick.candidates.some((c) => c.placeId === placeId)) {
      return fail(400, 'INVALID_CANDIDATE', 'Place is not a candidate in this Pick');
    }
    pick.participants.find((p) => p.userId === MOCK_USER_ID)?.answers.set(placeId, value);
    emit(pick.id);
    maybeAutoClose(pick);
    return json(200, { status: 'ok' });
  },

  'POST close': hostOnly((pick) => {
    if (pick.state === 'swiping') decide(pick);
    else if (pick.state !== 'final_vote' && pick.state !== 'completed') {
      return wrongState(`Pick is ${pick.state}`);
    }
    return json(200, {
      state: pick.state,
      winnerPlaceId: pick.winnerPlaceId,
      finalists: finalistsOf(pick).map((f) => f.placeId),
    });
  }),

  'POST vote': (pick, body) => {
    if (pick.state !== 'final_vote') return wrongState('Voting is not open for this Pick');
    const placeId =
      typeof body === 'object' && body !== null && 'placeId' in body ? body.placeId : null;
    if (typeof placeId !== 'string' || !placeId.trim()) {
      return fail(400, 'INVALID_INPUT', 'Expected a placeId');
    }
    if (!finalistsOf(pick).some((f) => f.placeId === placeId)) {
      return fail(400, 'INVALID_CANDIDATE', 'You can only vote for a finalist');
    }
    const mine = pick.participants.find((p) => p.userId === MOCK_USER_ID);
    if (mine) mine.vote = placeId;
    emit(pick.id);
    maybeSettleVote(pick);
    return json(200, { status: 'ok' });
  },

  'GET plan': (pick) => json(200, planOf(pick)),

  'GET reasons': (pick) => {
    if (pick.state !== 'final_vote' && pick.state !== 'completed') {
      return wrongState('The Pick has not closed yet');
    }
    const n = pick.participants.length;
    const count = (placeId: string, v: PreferenceValue) =>
      pick.participants.filter((p) => p.answers.get(placeId) === v).length;
    const reasons = pick.ranking
      .filter((r) => r.rank <= 3)
      .sort((a, b) => a.rank - b.rank)
      .map((r) => ({
        placeId: r.placeId,
        rank: r.rank,
        reason: explainRank({
          rank: r.rank,
          yes: count(r.placeId, 2),
          maybe: count(r.placeId, 1),
          no: count(r.placeId, 0),
          n,
        }),
      }));
    return json(200, { reasons });
  },

  'POST plan-time': hostOnly((pick, body) => {
    const planAt = (body as { planAt?: unknown } | null)?.planAt;
    const at = typeof planAt === 'string' ? Date.parse(planAt) : NaN;
    if (Number.isNaN(at) || at < Date.now() || at - Date.now() > 30 * 86_400_000) {
      return fail(400, 'INVALID_INPUT', 'planAt must be a date within the next 30 days');
    }
    if (pick.state !== 'completed') return wrongState('The Pick has no winner yet');
    plans(pick).planAt = new Date(at).toISOString();
    return json(200, { planAt: plans(pick).planAt });
  }),

  'POST rsvp': (pick, body) => {
    const status = (body as { status?: unknown } | null)?.status;
    if (status !== 'going' && status !== 'maybe' && status !== 'not_going') {
      return fail(400, 'INVALID_INPUT', 'status must be going, maybe or not_going');
    }
    if (pick.state !== 'completed') return wrongState('The Pick has no winner yet');
    plans(pick).rsvps.set(MOCK_USER_ID, status);
    return json(200, { status: 'ok' });
  },

  'POST outcome': (pick, body) => {
    const { went, again } = (body ?? {}) as { went?: unknown; again?: unknown };
    if (typeof went !== 'boolean' || (again != null && typeof again !== 'boolean')) {
      return fail(400, 'INVALID_INPUT', 'went must be true or false');
    }
    if (pick.state !== 'completed') return wrongState('The Pick has no winner yet');
    plans(pick).outcomes.set(MOCK_USER_ID, {
      went,
      again: typeof again === 'boolean' ? again : null,
    });
    return json(200, { status: 'ok' });
  },

  'POST again': (pick) => {
    if (pick.state !== 'completed' && pick.state !== 'canceled') {
      return wrongState('This Pick is still going');
    }
    const next = createMockPick({
      category: pick.category,
      center: pick.center,
      radiusM: pick.radiusM,
      poolSize: pick.poolSize,
      deadlineAt: null,
      closeThreshold: pick.closeThreshold,
    });
    next.participants.push(
      ...pick.participants
        .filter((p) => p.userId !== MOCK_USER_ID)
        .map((p) => ({ ...p, answers: new Map(), vote: null })),
    );
    return json(201, { pickId: next.id, state: 'draft' });
  },

  'POST close-vote': hostOnly((pick) => {
    if (pick.state === 'completed') return json(200, { status: 'ok' });
    if (pick.state !== 'final_vote') return wrongState('Voting is not open for this Pick');
    settleVote(pick);
    return json(200, { status: 'ok' });
  }),
};

export async function mockFetch(url: string, init: RequestInit): Promise<Response> {
  if (LATENCY_MS) await new Promise((r) => setTimeout(r, LATENCY_MS));
  const method = init.method ?? 'GET';
  const path = url.startsWith(MOCK_API_BASE_URL) ? url.slice(MOCK_API_BASE_URL.length) : url;

  if (method === 'GET' && path === '/health') return json(200, { status: 'ok' });

  const headers = (init.headers ?? {}) as Record<string, string>;
  if (headers.Authorization !== `Bearer ${MOCK_ACCESS_TOKEN}`) {
    return fail(401, 'UNAUTHENTICATED', 'Invalid or expired access token');
  }
  if (MOCK_FAIL_RATE > 0 && Math.random() < MOCK_FAIL_RATE) {
    return fail(503, 'UNAVAILABLE', 'WTW is having trouble right now (mock failure).');
  }

  if (method === 'POST' && path === '/picks') return createPick(readBody(init));
  if (method === 'POST' && path === '/picks/join') return joinPick(readBody(init));
  if (method === 'GET' && path === '/history') return json(200, { picks: historyOf() });
  // Groups aren't in mock mode yet: every group id is unknown.
  if (method === 'GET' && /^\/groups\/[^/]+\/history$/.test(path)) {
    return fail(404, 'GROUP_NOT_FOUND', 'Group not found');
  }
  if (method === 'GET' && path === '/notifications') {
    return json(200, {
      notifications: mockNotifications,
      unreadCount: mockNotifications.filter((n) => !n.readAt).length,
    });
  }
  const read = method === 'POST' && /^\/notifications\/([^/]+)\/read$/.exec(path);
  if (read) {
    const n = mockNotifications.find((x) => x.id === decodeURIComponent(read[1] ?? ''));
    if (!n) return fail(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found');
    n.readAt ??= new Date().toISOString();
    return json(200, { status: 'ok' });
  }

  const match = /^\/picks\/([^/]+)(?:\/([a-z-]+))?$/.exec(path);
  const handler = match ? ROUTES[`${method} ${match[2] ?? ''}`] : undefined;
  if (!match || !handler) return fail(404, 'NOT_FOUND', 'Route not found');

  const pick = mockPicks.get(decodeURIComponent(match[1] ?? ''));
  if (!pick) return fail(404, 'PICK_NOT_FOUND', 'Pick not found');
  if (!pick.participants.some((p) => p.userId === MOCK_USER_ID)) {
    return fail(403, 'FORBIDDEN', 'You must be a participant in this Pick');
  }
  touch(pick);
  return handler(pick, readBody(init));
}
