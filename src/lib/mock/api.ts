// A fake `fetch` for our Edge Function. It mirrors the API contract (docs/api-integration.md):
// same routes, status codes, error codes and response shapes, returned as real Response
// objects, so src/lib/api.ts runs the exact same parsing and error handling in both modes.
import { validateCreatePick, type CreatePickInput } from '@shared/domain/createPick.ts';
import { parseJoinCode } from '@shared/domain/joinCode.ts';

import { MOCK_FAIL_RATE } from '../config';
import type { PreferenceValue } from '../types';
import { MOCK_ACCESS_TOKEN, MOCK_USER_ID } from './auth';
import { MOCK_PLACES } from './fixtures';
import {
  acceptMockInvite,
  createMockInvite,
  createMockPick,
  decide,
  emit,
  finalistsOf,
  joinMockPick,
  maybeAutoClose,
  maybeSettleVote,
  mockBlocks,
  mockPicks,
  progressOf,
  revokeMockInvite,
  scheduleBots,
  settleVote,
  touch,
  type MockPick,
} from './store';

export const MOCK_API_BASE_URL = 'https://mock.wtw.local/functions/v1/api';

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
    return fail(
      404,
      'JOIN_CODE_NOT_FOUND',
      'That code isn’t valid, or the Pick isn’t taking new people',
    );
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

  'POST lock': hostOnly((pick, body) => {
    const locked = (body as { locked?: unknown } | null)?.locked;
    if (typeof locked !== 'boolean')
      return fail(400, 'INVALID_INPUT', 'Expected locked: true or false');
    if (pick.state !== 'draft' && pick.state !== 'swiping') {
      return fail(409, 'PICK_CLOSED', 'This Pick is no longer accepting people');
    }
    pick.lobbyLocked = locked;
    return json(200, { locked });
  }),

  'POST cancel': hostOnly((pick) => {
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

const INVITE_NOT_FOUND = () =>
  fail(404, 'INVITE_NOT_FOUND', 'That invite link isn’t valid any more. Ask for a new one.');

/** Invites, blocks and reports (0014), or null for any other path. */
function safetyRoute(method: string, path: string, body: unknown): Response | null {
  if (method === 'POST' && path === '/invites') {
    const { kind, targetId } = (body ?? {}) as { kind?: unknown; targetId?: unknown };
    const pick = typeof targetId === 'string' ? mockPicks.get(targetId) : undefined;
    if (kind !== 'pick' || !pick) return fail(404, 'NOT_FOUND', 'Pick not found');
    if (pick.hostId !== MOCK_USER_ID)
      return fail(403, 'FORBIDDEN', 'Only the host can make invite links');
    const token = createMockInvite(pick);
    return json(201, {
      token,
      url: `wtw://i/${token}`,
      kind,
      targetId: pick.id,
      expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      maxUses: null,
    });
  }
  const invite = /^\/invites\/([^/]+)(\/accept)?$/.exec(path);
  if (invite) {
    const token = decodeURIComponent(invite[1] ?? '');
    if (method === 'POST' && invite[2]) {
      const result = acceptMockInvite(token);
      return result === 'not_found'
        ? INVITE_NOT_FOUND()
        : json(200, { kind: 'pick', targetId: result.pickId });
    }
    if (method === 'DELETE' && !invite[2]) {
      return revokeMockInvite(token)
        ? json(200, { status: 'ok' })
        : fail(404, 'NOT_FOUND', 'Invite not found');
    }
  }
  const block = /^\/blocks\/([^/]+)(\/remove)?$/.exec(path);
  if (block && method === 'POST') {
    const userId = decodeURIComponent(block[1] ?? '');
    if (userId === MOCK_USER_ID) return fail(400, 'INVALID_INPUT', 'You can’t block yourself');
    if (block[2]) mockBlocks.delete(userId);
    else mockBlocks.add(userId);
    return json(200, { status: 'ok' });
  }
  if (method === 'POST' && path === '/reports') {
    const { kind, targetId, reason } = (body ?? {}) as Record<string, unknown>;
    const ok =
      (kind === 'user' || kind === 'pick' || kind === 'group') &&
      // Mock ids aren't UUIDs, so only the shape is checked.
      typeof targetId === 'string' &&
      typeof reason === 'string' &&
      reason.trim().length >= 1 &&
      reason.trim().length <= 500;
    return ok ? json(201, { status: 'ok' }) : fail(400, 'INVALID_INPUT', 'Invalid report');
  }
  return null;
}

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
  const safety = safetyRoute(method, path, readBody(init));
  if (safety) return safety;

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
