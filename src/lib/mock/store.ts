// In-memory "backend" state for mock mode. Resets when the app reloads, or via resetMockData().
// It plays the server's part of the whole loop (lobby -> swipe -> close -> vote -> winner) with
// three pretend friends, Ava, Ben and Cam, who join, swipe and vote on timers, so the live
// screens move on their own in a demo. Rules come from the shared domain code, not copies.
import { makeCustomOptions, type StoredCustomOption } from '@shared/domain/customPlans.ts';
import { customPlaces } from './saved';
import type { CreatePickInput } from '@shared/domain/createPick.ts';
import { dueToClose } from '@shared/domain/pickState.ts';
import { EMPTY_PREFERENCES, type Preferences } from '@shared/domain/preferences.ts';
import {
  answerFromDb,
  clearWinner,
  rankCandidates,
  voteWinner,
  type RankedCandidate,
} from '@shared/domain/ranking.ts';

import { FRIENDS } from '@/components/theme';

import type {
  DecidedBy,
  PickOutcome,
  PickProgress,
  PickState,
  PickSummary,
  PreferenceValue,
  RankedPlace,
} from '../types';
import type { PlaceFilters } from '@shared/domain/placeFilters.ts';
import { mockPool } from './placePool';
import { MOCK_USER_ID } from './auth';
import { DEMO_CENTER, MOCK_PLACES, OTHER_PARTICIPANT_ANSWERS, type MockPlace } from './fixtures';

export interface MockParticipant {
  userId: string;
  name: string;
  answers: Map<string, PreferenceValue>;
  vote: string | null;
  /** Bots answer like this, by index into MOCK_PLACES. */
  script?: readonly PreferenceValue[];
}

export interface MockPick extends PlaceFilters {
  id: string;
  hostId: string;
  state: PickState;
  category: 'food' | 'activities' | 'custom';
  includeSaved?: boolean;
  customOptions?: StoredCustomOption[];
  mixCategory?: 'food' | 'activities';
  center: { lat: number; lng: number };
  radiusM: number;
  poolSize: number;
  deadlineAt: string | null;
  /** When the final vote closes (Alan's picks.vote_deadline_at); null outside final_vote. */
  voteDeadlineAt: string | null;
  closeThreshold: number;
  /** Empty until the host starts the Pick. */
  candidates: MockPlace[];
  participants: MockParticipant[];
  /** Rank + finalist only; scores stay "on the server" in `ranked`. */
  ranking: RankedPlace[];
  ranked: RankedCandidate[];
  winnerPlaceId: string | null;
  decidedBy: DecidedBy | null;
  decidedAt: string | null;
  joinCode: string;
  /** Host's "lock lobby" (0014): no new people by code or link. */
  lobbyLocked?: boolean;
  /** Existing plan time supplied by a Hang; used to initialize mock RSVP state. */
  planAt?: string;
  /** For newest-first ordering; fixtures count down from 0. */
  createdAt: number;
}

/** People I blocked (0014). Declared before anything runs at load (see bug #7). */
export const mockBlocks = new Set<string>();
/** Invite links by token. */
const mockInvites = new Map<string, { pickId: string; revoked: boolean }>();

// ---------------------------------------------------------------------------
// Change notifications (stands in for Supabase Realtime in mock mode)
// ---------------------------------------------------------------------------
const listeners = new Map<string, Set<() => void>>();

export function subscribeMock(pickId: string, fn: () => void): () => void {
  const set = listeners.get(pickId) ?? new Set();
  set.add(fn);
  listeners.set(pickId, set);
  return () => set.delete(fn);
}

export function emit(pickId: string) {
  for (const fn of listeners.get(pickId) ?? []) fn();
}

const timers = new Set<ReturnType<typeof setTimeout>>();
const scheduled = new Set<string>();

function later(ms: number, fn: () => void) {
  const t = setTimeout(() => {
    timers.delete(t);
    fn();
  }, ms);
  timers.add(t);
}

/** Same as the API's VOTE_WINDOW_MS (closing.ts): the final vote stays open 30 minutes. */
export const VOTE_WINDOW_MS = 30 * 60_000;

const FRIEND_IDS = ['mock-ava', 'mock-ben', 'mock-cam'] as const;

/** Bots run on timers in the app; tests turn them off and drive the store directly. */
let botsEnabled = process.env.NODE_ENV !== 'test';
export function setMockBots(enabled: boolean) {
  botsEnabled = enabled;
}

/**
 * My profile (public.profiles in mock form). Starts without a name or survey, like a new
 * account, so mock mode shows the name step and onboarding. Survives resetMockData().
 */
export const mockProfile: {
  displayName: string | null;
  preferences: Preferences;
  onboarded: boolean;
  pushTokens: string[];
} = { displayName: null, preferences: EMPTY_PREFERENCES, onboarded: false, pushTokens: [] };

/** Back to a brand-new account (what DELETE /me leaves behind). */
export function resetMockProfile() {
  Object.assign(mockProfile, {
    displayName: null,
    preferences: EMPTY_PREFERENCES,
    onboarded: false,
    pushTokens: [],
  });
}

const me = (): MockParticipant => ({
  userId: MOCK_USER_ID,
  name: 'You',
  answers: new Map(),
  vote: null,
});

function friend(i: number): MockParticipant {
  return {
    userId: FRIEND_IDS[i]!,
    name: FRIENDS[i]!.name,
    answers: new Map(),
    vote: null,
    script: OTHER_PARTICIPANT_ANSWERS[i],
  };
}

/** Same alphabet as Razin's pick_join_codes: no O/0/I/1. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function makeJoinCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return code;
}

/** In mock mode, this code joins a friend's draft Pick (same rules as pick_join in 0006). */
export const MOCK_INVITE_CODE = 'WTW234';

function base(id: string, over: Partial<MockPick>): MockPick {
  return {
    id,
    hostId: MOCK_USER_ID,
    state: 'swiping',
    category: 'food',
    center: DEMO_CENTER,
    radiusM: 3219,
    poolSize: MOCK_PLACES.length,
    deadlineAt: null,
    voteDeadlineAt: null,
    closeThreshold: 100,
    candidates: [...MOCK_PLACES],
    participants: [me(), friend(0), friend(1), friend(2)],
    ranking: [],
    ranked: [],
    winnerPlaceId: null,
    decidedBy: null,
    decidedAt: null,
    joinCode: makeJoinCode(),
    createdAt: 0,
    ...over,
  };
}

/** Bots who already finished swiping (fixture Picks that are past swiping). */
function finished(p: MockParticipant, pick: MockPick) {
  pick.candidates.forEach((c, i) => p.answers.set(c.placeId, p.script?.[i] ?? 1));
  return p;
}

function initial(): Map<string, MockPick> {
  const picks: MockPick[] = [];

  // The live-demo Pick: I host, the three friends swipe while I do, Tiger Lily Café wins.
  picks.push(base('demo-pick', { createdAt: -1 }));

  // A friend's Pick: I'm a guest, so no host buttons.
  picks.push(
    base('friend-pick', {
      category: 'activities',
      candidates: mockPool({ category: 'activities', center: DEMO_CENTER, radiusM: 5000 }),
      hostId: FRIEND_IDS[0],
      createdAt: -2,
    }),
  );

  // Already in the final vote: shows the ballot (three finalists, two of them tied at #1).
  const vote = base('vote-pick', {
    state: 'final_vote',
    hostId: FRIEND_IDS[1],
    voteDeadlineAt: new Date(Date.now() + VOTE_WINDOW_MS).toISOString(),
    createdAt: -3,
  });
  vote.participants.forEach((p) => finished(p, vote));
  vote.ranked = rankCandidates(
    vote.candidates.map((c) => ({ placeId: c.placeId, lat: c.lat, lng: c.lng })),
    [],
    vote.participants.length,
    vote.center,
  );
  const finalists = [MOCK_PLACES[2]!, MOCK_PLACES[0]!, MOCK_PLACES[11]!].map((p) => p.placeId);
  vote.ranked = [
    ...finalists.map((placeId, i) => ({
      ...vote.ranked.find((r) => r.placeId === placeId)!,
      rank: i + 1,
    })),
    ...vote.ranked
      .filter((r) => !finalists.includes(r.placeId))
      .map((r, i) => ({ ...r, rank: i + 4 })),
  ];
  vote.ranking = vote.ranked.map((r) => ({
    placeId: r.placeId,
    rank: r.rank,
    finalist: finalists.includes(r.placeId),
  }));
  picks.push(vote);

  // A friend's draft Pick I'm not in yet: join it with MOCK_INVITE_CODE ("Join with code").
  picks.push(
    base('invite-pick', {
      state: 'draft',
      hostId: FRIEND_IDS[0],
      candidates: [],
      participants: [friend(0), friend(1)],
      joinCode: MOCK_INVITE_CODE,
      createdAt: -5,
    }),
  );

  // History: decided last week.
  const done = base('done-pick', { state: 'completed', createdAt: -4 });
  done.participants.forEach((p) => finished(p, done));
  decide(done, new Date(Date.now() - 6 * 86_400_000));
  picks.push(done);

  return new Map(picks.map((p) => [p.id, p]));
}

export const mockPicks: Map<string, MockPick> = initial();

export function resetMockData() {
  for (const t of timers) clearTimeout(t);
  timers.clear();
  scheduled.clear();
  mockPicks.clear();
  mockBlocks.clear();
  mockInvites.clear();
  for (const [id, pick] of initial()) mockPicks.set(id, pick);
  for (const id of listeners.keys()) emit(id);
}

// ---------------------------------------------------------------------------
// Server rules
// ---------------------------------------------------------------------------
export const isDone = (pick: MockPick, p: MockParticipant) =>
  pick.candidates.length > 0 && pick.candidates.every((c) => p.answers.has(c.placeId));

let customIdCounter = 0;
export function createMockPick(input: CreatePickInput, hostId = MOCK_USER_ID): MockPick {
  const id = `mock-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  const options = makeCustomOptions(
    input.customOptions ?? [],
    hostId,
    input.center,
    () =>
      `${Date.now().toString(16).slice(-8).padStart(8, '0')}-0000-4000-8000-${(++customIdCounter).toString(16).padStart(12, '0')}`,
  );
  for (const option of options) customPlaces.set(option.placeId, option);
  const pick = base(id, {
    hostId,
    includeSaved: input.includeSaved,
    customOptions: options,
    mixCategory: input.mixCategory,
    state: 'draft',
    category: input.category,
    center: input.center,
    radiusM: input.radiusM,
    priceMax: input.priceMax,
    openNow: input.openNow,
    poolSize: input.poolSize,
    deadlineAt: input.deadlineAt,
    closeThreshold: input.closeThreshold,
    candidates: [],
    participants: [{ ...me(), userId: hostId, name: hostId === MOCK_USER_ID ? 'You' : 'Host' }],
    createdAt: Date.now(),
  });
  mockPicks.set(id, pick);
  return pick;
}

/** swiping -> ranking -> completed (clear winner) or final_vote. Idempotent. */
export function decide(pick: MockPick, now = new Date()) {
  if (pick.state !== 'swiping' && pick.state !== 'completed') return;
  pick.ranked = rankCandidates(
    pick.candidates.map((c) => ({ placeId: c.placeId, lat: c.lat, lng: c.lng })),
    pick.participants.flatMap((p) =>
      [...p.answers].map(([placeId, v]) => ({ placeId, answer: answerFromDb(v) })),
    ),
    pick.participants.length,
    pick.center,
  );
  const decision = clearWinner(pick.ranked);
  const finalists = new Set(
    decision.kind === 'vote' ? decision.finalists.map((f) => f.placeId) : [],
  );
  pick.ranking = pick.ranked.map((r) => ({
    placeId: r.placeId,
    rank: r.rank,
    finalist: finalists.has(r.placeId),
  }));
  if (decision.kind === 'winner') {
    pick.state = 'completed';
    pick.winnerPlaceId = decision.winner.placeId;
    pick.decidedBy = 'clear_winner';
    pick.decidedAt = now.toISOString();
  } else {
    pick.state = 'final_vote';
    pick.voteDeadlineAt = new Date(now.getTime() + VOTE_WINDOW_MS).toISOString();
  }
  emit(pick.id);
  if (pick.state === 'final_vote') scheduleBots(pick);
}

/** Close when enough people are done or the deadline passed (the real API checks after every swipe; the sweep covers deadlines). */
export function maybeAutoClose(pick: MockPick, now = new Date()) {
  if (pick.state !== 'swiping') return;
  const due = dueToClose({
    done: pick.participants.filter((p) => isDone(pick, p)).length,
    n: pick.participants.length,
    thresholdPct: pick.closeThreshold,
    deadlineAt: pick.deadlineAt ? new Date(pick.deadlineAt) : null,
    now,
  });
  if (due) decide(pick, now);
}

export function finalistsOf(pick: MockPick) {
  const ids = new Set(pick.ranking.filter((r) => r.finalist).map((r) => r.placeId));
  return pick.ranked.filter((r) => ids.has(r.placeId)).sort((a, b) => a.rank - b.rank);
}

/** Tally: most votes; a tie goes to the better rank (score, then distance, then id). */
export function settleVote(pick: MockPick, now = new Date()) {
  if (pick.state !== 'final_vote') return;
  const finalists = finalistsOf(pick);
  const ballots = pick.participants.flatMap((p) => (p.vote ? [p.vote] : []));
  const winner = voteWinner(finalists, ballots);
  const counts = finalists.map((f) => ballots.filter((b) => b === f.placeId).length);
  const top = Math.max(...counts);
  pick.state = 'completed';
  pick.winnerPlaceId = winner.placeId;
  pick.decidedBy = counts.filter((c) => c === top).length > 1 ? 'tie_break' : 'vote';
  pick.decidedAt = now.toISOString();
  emit(pick.id);
}

export function maybeSettleVote(pick: MockPick) {
  if (pick.state === 'final_vote' && pick.participants.every((p) => p.vote)) settleVote(pick);
}

// ---------------------------------------------------------------------------
// The pretend friends
// ---------------------------------------------------------------------------
/**
 * Moves the bots along for the Pick's current state: join a draft, finish swiping, vote.
 * Runs once per (Pick, state). They never reveal answers; only "joined" / "done" / "voted".
 */
export function scheduleBots(pick: MockPick) {
  const key = `${pick.id}:${pick.state}`;
  if (!botsEnabled || scheduled.has(key)) return;
  scheduled.add(key);
  const bots = () => pick.participants.filter((p) => p.userId !== MOCK_USER_ID);

  if (pick.state === 'draft') {
    [0, 1, 2].forEach((i) =>
      later(1500 + i * 1800, () => {
        if (pick.state !== 'draft' && pick.state !== 'swiping') return;
        if (pick.participants.some((p) => p.userId === FRIEND_IDS[i])) return;
        pick.participants.push(friend(i));
        emit(pick.id);
      }),
    );
  } else if (pick.state === 'swiping') {
    bots().forEach((bot, i) =>
      later(9000 + i * 6500, () => {
        if (pick.state !== 'swiping') return;
        pick.candidates.forEach((c, j) => bot.answers.set(c.placeId, bot.script?.[j] ?? 1));
        emit(pick.id);
        maybeAutoClose(pick);
      }),
    );
  } else if (pick.state === 'final_vote') {
    bots().forEach((bot, i) =>
      later(2500 + i * 2000, () => {
        if (pick.state !== 'final_vote' || bot.vote) return;
        const finalists = finalistsOf(pick);
        // Ava and Cam agree, Ben goes his own way: a vote, not a tie (unless you tie it).
        bot.vote = finalists[i === 1 ? 1 : 0]?.placeId ?? null;
        emit(pick.id);
        maybeSettleVote(pick);
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------
export function summaryOf(pick: MockPick): PickSummary {
  return { id: pick.id, state: pick.state, category: pick.category, deadlineAt: pick.deadlineAt };
}

export function outcomeOf(pick: MockPick): PickOutcome {
  return {
    state: pick.state,
    hostId: pick.hostId,
    winnerPlaceId: pick.winnerPlaceId,
    decidedBy: pick.decidedBy,
  };
}

export function progressOf(pick: MockPick): PickProgress {
  // Host first, then join order: the same order as the real GET /picks/:id/progress.
  const participants = pick.participants
    .map((p) => ({
      userId: p.userId,
      displayName: p.userId === MOCK_USER_ID ? (mockProfile.displayName ?? p.name) : p.name,
      isHost: p.userId === pick.hostId,
      isMe: p.userId === MOCK_USER_ID,
      done: isDone(pick, p),
      voted: p.vote !== null,
    }))
    .sort((a, b) => Number(b.isHost) - Number(a.isHost));
  return {
    state: pick.state,
    // Like the real route: in the final vote, count down the vote's own deadline.
    deadlineAt: pick.state === 'final_vote' ? pick.voteDeadlineAt : pick.deadlineAt,
    participants,
    doneCount: participants.filter((p) => p.done).length,
    votedCount: participants.filter((p) => p.voted).length,
    total: participants.length,
  };
}

/** POST /picks/join rules (0014): draft/swiping, unlocked, under 30; twice is a no-op. */
export function joinMockPick(code: string): { pickId: string } | 'not_found' {
  const pick = [...mockPicks.values()].find((p) => p.joinCode === code);
  return pick ? admitMe(pick) : 'not_found';
}

function admitMe(pick: MockPick): { pickId: string } | 'not_found' {
  if (pick.participants.some((p) => p.userId === MOCK_USER_ID)) return { pickId: pick.id };
  if (
    (pick.state !== 'draft' && pick.state !== 'swiping') ||
    pick.lobbyLocked ||
    pick.participants.length >= 30 ||
    mockBlocks.has(pick.hostId)
  ) {
    return 'not_found';
  }
  pick.participants.push(me());
  emit(pick.id);
  return { pickId: pick.id };
}

// ---------------------------------------------------------------------------
// Invite links and blocks (0014)
// ---------------------------------------------------------------------------
const TOKEN_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function createMockInvite(pick: MockPick, random: () => number = Math.random): string {
  let token = '';
  for (let i = 0; i < 22; i++) token += TOKEN_CHARS[Math.floor(random() * 64)];
  mockInvites.set(token, { pickId: pick.id, revoked: false });
  return token;
}

export function acceptMockInvite(token: string): { pickId: string } | 'not_found' {
  const invite = mockInvites.get(token);
  const pick = invite && !invite.revoked ? mockPicks.get(invite.pickId) : undefined;
  return pick ? admitMe(pick) : 'not_found';
}

/** Only links I made (in mock mode, every link is mine). */
export function revokeMockInvite(token: string): boolean {
  const invite = mockInvites.get(token);
  if (!invite) return false;
  invite.revoked = true;
  return true;
}

/** Lazily applies the deadline (the real deadline sweep runs every minute) and wakes the bots. */
export function touch(pick: MockPick, now = new Date()) {
  maybeAutoClose(pick, now);
  if (pick.state === 'final_vote' && pick.voteDeadlineAt && now >= new Date(pick.voteDeadlineAt)) {
    settleVote(pick, now);
  }
  scheduleBots(pick);
}
