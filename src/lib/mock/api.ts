// A fake `fetch` for our Edge Function. It returns real Response objects in the API's
// shapes (including `{ error: { code, message } }`), so src/lib/api.ts runs the exact
// same parsing and error handling in mock and real mode.
import { answerFromDb, clearWinner, rankCandidates } from '@shared/domain/ranking.ts';

import { MOCK_FAIL_RATE } from '../config';
import type { PreferenceValue } from '../types';
import { MOCK_ACCESS_TOKEN } from './auth';
import { DEMO_CENTER, DEMO_PICK_ID, MOCK_PLACES, OTHER_PARTICIPANT_ANSWERS } from './fixtures';
import { mockState } from './store';

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
function rank() {
  const candidates = MOCK_PLACES.map((p) => ({ placeId: p.placeId, lat: p.lat, lng: p.lng }));
  const mine = [...mockState.myPreferences].map(([placeId, v]) => ({
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
    decision.kind === 'winner'
      ? [decision.winner.placeId]
      : decision.finalists.map((f) => f.placeId),
  );

  // Like the real API: keep rank + finalist for the app; the score never leaves the "server".
  mockState.ranking = ranked.map((r) => ({
    placeId: r.placeId,
    rank: r.rank,
    finalist: finalists.has(r.placeId),
  }));
  mockState.outcome =
    decision.kind === 'winner'
      ? { state: 'completed', winnerPlaceId: decision.winner.placeId, decidedBy: 'clear_winner' }
      : { state: 'final_vote', winnerPlaceId: null, decidedBy: null };
}

function readBody(init: RequestInit): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(typeof init.body === 'string' ? init.body : 'null');
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function mockFetch(url: string, init: RequestInit): Promise<Response> {
  await new Promise((r) => setTimeout(r, LATENCY_MS));
  const method = init.method ?? 'GET';
  const path = url.startsWith(MOCK_API_BASE_URL) ? url.slice(MOCK_API_BASE_URL.length) : url;

  if (method === 'GET' && path === '/health') return json(200, { ok: true });

  const headers = (init.headers ?? {}) as Record<string, string>;
  if (headers.Authorization !== `Bearer ${MOCK_ACCESS_TOKEN}`) {
    return fail(401, 'unauthorized', 'Please sign in again.');
  }
  if (MOCK_FAIL_RATE > 0 && Math.random() < MOCK_FAIL_RATE) {
    return fail(503, 'unavailable', 'WTW is having trouble right now (mock failure).');
  }

  const match = /^\/picks\/([^/]+)\/(swipes|rank)$/.exec(path);
  if (method !== 'POST' || !match) return fail(404, 'not_found', `No route for ${method} ${path}.`);
  const [, pickId = '', action] = match;
  if (decodeURIComponent(pickId) !== DEMO_PICK_ID) {
    return fail(404, 'pick_not_found', 'That Pick doesn’t exist or you’re not in it.');
  }

  if (action === 'swipes') {
    if (mockState.outcome.state !== 'swiping') {
      return fail(409, 'invalid_state', 'This Pick is no longer taking answers.');
    }
    const { placeId, value } = readBody(init);
    if (typeof placeId !== 'string' || !isPreferenceValue(value)) {
      return fail(400, 'invalid_body', 'Expected { placeId: string, value: 0 | 1 | 2 }.');
    }
    if (!MOCK_PLACES.some((p) => p.placeId === placeId)) {
      return fail(400, 'not_a_candidate', 'That place isn’t in this Pick.');
    }
    mockState.myPreferences.set(placeId, value);
    return json(200, { ok: true });
  }

  // rank: idempotent once the Pick has been decided.
  if (mockState.outcome.state === 'swiping' || mockState.outcome.state === 'ranking') rank();
  return json(200, { ok: true });
}
