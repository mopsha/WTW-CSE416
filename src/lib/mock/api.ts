// A fake `fetch` for our Edge Function. It mirrors Josh's contract (docs/api-integration.md):
// same routes, status codes, error codes and response shapes, returned as real Response
// objects, so src/lib/api.ts runs the exact same parsing and error handling in both modes.
import { answerFromDb, clearWinner, rankCandidates } from '@shared/domain/ranking.ts';

import { MOCK_FAIL_RATE } from '../config';
import type { PreferenceValue } from '../types';
import { MOCK_ACCESS_TOKEN, MOCK_USER_ID } from './auth';
import { DEMO_CENTER, MOCK_PLACES, OTHER_PARTICIPANT_ANSWERS } from './fixtures';
import { mockPicks, type MockPick } from './store';

export const MOCK_API_BASE_URL = 'https://mock.wtw.local/functions/v1/api';

const LATENCY_MS = 350;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const fail = (status: number, code: string, message: string) =>
  json(status, { error: { code, message } });

function isPreferenceValue(v: unknown): v is PreferenceValue {
  return v === 0 || v === 1 || v === 2;
}

/** Runs Alan's real ranking engine over my answers plus the fixture participants. */
function rank(pick: MockPick) {
  const candidates = MOCK_PLACES.map((p) => ({ placeId: p.placeId, lat: p.lat, lng: p.lng }));
  const mine = [...pick.myPreferences].map(([placeId, v]) => ({
    placeId,
    answer: answerFromDb(v),
  }));
  const others = OTHER_PARTICIPANT_ANSWERS.flatMap((row) =>
    row.map((v, i) => ({ placeId: candidates[i]?.placeId ?? '', answer: answerFromDb(v) })),
  );
  const n = OTHER_PARTICIPANT_ANSWERS.length + 1;
  const ranked = rankCandidates(candidates, [...mine, ...others], n, DEMO_CENTER);
  const decision = clearWinner(ranked);
  const finalists = new Set(
    decision.kind === 'vote' ? decision.finalists.map((f) => f.placeId) : [],
  );

  // Like the real API: store rank + finalist; the score never leaves the "server".
  pick.ranking = ranked.map((r) => ({
    placeId: r.placeId,
    rank: r.rank,
    finalist: finalists.has(r.placeId),
  }));
  pick.outcome =
    decision.kind === 'winner'
      ? {
          ...pick.outcome,
          state: 'completed',
          winnerPlaceId: decision.winner.placeId,
          decidedBy: 'clear_winner',
        }
      : { ...pick.outcome, state: 'final_vote', winnerPlaceId: null, decidedBy: null };

  const visible = ({ placeId, rank }: { placeId: string; rank: number }) => ({ placeId, rank });
  return {
    results: ranked.slice(0, 3).map(visible),
    decision:
      decision.kind === 'winner'
        ? { kind: 'winner', winner: visible(decision.winner) }
        : { kind: 'vote', finalists: decision.finalists.map(visible) },
  };
}

function readBody(init: RequestInit): unknown {
  try {
    return JSON.parse(typeof init.body === 'string' ? init.body : '');
  } catch {
    return undefined;
  }
}

export async function mockFetch(url: string, init: RequestInit): Promise<Response> {
  await new Promise((r) => setTimeout(r, LATENCY_MS));
  const method = init.method ?? 'GET';
  const path = url.startsWith(MOCK_API_BASE_URL) ? url.slice(MOCK_API_BASE_URL.length) : url;

  if (method === 'GET' && path === '/health') return json(200, { status: 'ok' });

  const match = /^\/picks\/([^/]+)\/(swipes|rank)$/.exec(path);
  if (method !== 'POST' || !match) return fail(404, 'NOT_FOUND', 'Route not found');

  const headers = (init.headers ?? {}) as Record<string, string>;
  if (headers.Authorization !== `Bearer ${MOCK_ACCESS_TOKEN}`) {
    return fail(401, 'UNAUTHENTICATED', 'Invalid or expired access token');
  }
  if (MOCK_FAIL_RATE > 0 && Math.random() < MOCK_FAIL_RATE) {
    return fail(503, 'UNAVAILABLE', 'WTW is having trouble right now (mock failure).');
  }

  const [, rawId = '', action] = match;
  const pick = mockPicks.get(decodeURIComponent(rawId));
  if (!pick) return fail(404, 'PICK_NOT_FOUND', 'Pick not found');
  if (pick.outcome.state !== 'swiping') {
    return fail(409, 'INVALID_PICK_STATE', 'Pick must be swiping');
  }

  if (action === 'swipes') {
    const body = readBody(init);
    if (body === undefined) return fail(400, 'INVALID_JSON', 'Request body must be valid JSON');
    const { placeId, value } = (typeof body === 'object' && body !== null ? body : {}) as Record<
      string,
      unknown
    >;
    if (typeof placeId !== 'string' || !placeId.trim() || !isPreferenceValue(value)) {
      return fail(400, 'INVALID_INPUT', 'Expected placeId and value 0, 1, or 2');
    }
    if (!MOCK_PLACES.some((p) => p.placeId === placeId)) {
      return fail(400, 'INVALID_CANDIDATE', 'Place is not a candidate in this Pick');
    }
    pick.myPreferences.set(placeId, value);
    return json(200, { status: 'ok' });
  }

  if (pick.outcome.hostId !== MOCK_USER_ID) {
    return fail(403, 'FORBIDDEN', 'Only the host can close swiping and rank');
  }
  return json(200, rank(pick));
}
