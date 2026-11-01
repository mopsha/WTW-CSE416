// A fake `fetch` for our Edge Function. It mirrors the API contract (docs/api-integration.md):
// same routes, status codes, error codes and response shapes, returned as real Response
// objects, so src/lib/api.ts runs the exact same parsing and error handling in both modes.
import type { NotificationRow } from '@shared/api/notify.ts';
import { validateCreatePick, type CreatePickInput } from '@shared/domain/createPick.ts';
import { parseJoinCode } from '@shared/domain/joinCode.ts';
import { validateDisplayName } from '@shared/api/profile.ts';

import { MOCK_FAIL_RATE } from '../config';
import type { PreferenceValue } from '../types';
import { MOCK_ACCESS_TOKEN, MOCK_USER_ID, mockAuth } from './auth';
import { MOCK_PLACES } from './fixtures';
import { handleMockFriends } from './friends';
import {
  createMockPick,
  decide,
  emit,
  finalistsOf,
  joinMockPick,
  maybeAutoClose,
  maybeSettleVote,
  mockPicks,
  mockProfile,
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

/** POST /me: same validation as the API (shared validateDisplayName). */
function updateMe(body: unknown): Response {
  if (body === undefined) return fail(400, 'INVALID_JSON', 'Request body must be valid JSON');
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return fail(400, 'INVALID_INPUT', 'Expected a profile object');
  }
  const result = validateDisplayName((body as { displayName?: unknown }).displayName);
  if ('error' in result) return fail(400, 'INVALID_INPUT', result.error);
  mockProfile.displayName = result.name;
  for (const id of mockPicks.keys()) emit(id);
  return json(200, { displayName: result.name });
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
  if (method === 'POST' && path === '/me') return updateMe(readBody(init));

  if (path.startsWith('/friends')) {
    const session = await mockAuth.getSession();
    const result = handleMockFriends(method, path, readBody(init), session?.user.email ?? null);
    return result ? json(result.status, result.body) : fail(404, 'NOT_FOUND', 'Route not found');
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
