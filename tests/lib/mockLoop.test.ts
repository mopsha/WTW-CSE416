// The mock backend plays the whole MVP loop through the real API client, so mock mode
// (the demo fallback) behaves like the server: same routes, errors and state changes.
import { createApiClient } from '@/lib/api';
import { MOCK_ACCESS_TOKEN, MOCK_USER_ID } from '@/lib/mock/auth';
import { MOCK_API_BASE_URL, mockFetch } from '@/lib/mock/api';
import { MOCK_PLACES } from '@/lib/mock/fixtures';
import { mockQueries } from '@/lib/mock/queries';
import {
  makeJoinCode,
  mockPicks,
  resetMockData,
  setMockBots,
  subscribeMock,
} from '@/lib/mock/store';

const api = createApiClient({
  baseUrl: MOCK_API_BASE_URL,
  getAccessToken: async () => MOCK_ACCESS_TOKEN,
  fetch: mockFetch,
});

const input = () => ({
  category: 'food' as const,
  center: { lat: 40.9126, lng: -73.1234 },
  radiusM: 3219,
  poolSize: 10,
  deadlineAt: null,
  closeThreshold: 100,
});

function addFriend(pickId: string, name: string) {
  mockPicks.get(pickId)!.participants.push({
    userId: `bot-${name}`,
    name,
    answers: new Map(),
    vote: null,
  });
}

function friendAnswersAll(pickId: string, value: 0 | 1 | 2) {
  const pick = mockPicks.get(pickId)!;
  for (const p of pick.participants.filter((x) => x.userId !== MOCK_USER_ID)) {
    pick.candidates.forEach((c) => p.answers.set(c.placeId, value));
  }
}

beforeAll(() => setMockBots(false));
beforeEach(() => resetMockData());

test('create -> lobby -> start needs 2 people -> swipe -> auto-close -> completed', async () => {
  const { pickId } = await api.createPick(input());
  expect((await api.getProgress(pickId)).total).toBe(1);
  await expect(api.startPick(pickId)).rejects.toMatchObject({
    status: 409,
    code: 'NOT_ENOUGH_PARTICIPANTS',
  });

  addFriend(pickId, 'Ava');
  await expect(api.startPick(pickId)).resolves.toMatchObject({ candidateCount: 10 });
  const pick = await api.getPick(pickId);
  expect(pick).toMatchObject({ state: 'swiping', isHost: true, participantCount: 2 });
  expect(pick.candidates).toHaveLength(10);

  friendAnswersAll(pickId, 2);
  for (const c of pick.candidates) await api.submitSwipe(pickId, c.placeId, 2);
  // Everyone done at a 100% threshold: closes by itself.
  const after = await api.getPick(pickId);
  expect(after.state === 'completed' || after.state === 'final_vote').toBe(true);
  const ranking = await mockQueries.getRankingResults(pickId);
  expect(ranking.length).toBe(10);
  expect(ranking.every((r) => !('score' in r))).toBe(true);
});

test('reopening resumes with my saved answers', async () => {
  const first = MOCK_PLACES[0]!.placeId;
  await api.submitSwipe('demo-pick', first, 1);
  const pick = await api.getPick('demo-pick');
  expect(pick.myAnswers).toEqual({ [first]: 1 });
});

test('progress shows who is done, never answers', async () => {
  for (const c of MOCK_PLACES) await api.submitSwipe('demo-pick', c.placeId, 0);
  const progress = await api.getProgress('demo-pick');
  expect(progress.participants.find((p) => p.isMe)?.done).toBe(true);
  expect(progress.doneCount).toBe(1);
  expect(JSON.stringify(progress)).not.toMatch(/answers|value/);
});

test('host close-now decides; a guest cannot', async () => {
  await expect(api.closePick('friend-pick')).rejects.toMatchObject({ status: 403 });
  const res = await api.closePick('demo-pick');
  expect(['completed', 'final_vote']).toContain(res.state);
  // Idempotent: closing again reports the same decision.
  await expect(api.closePick('demo-pick')).resolves.toMatchObject({ state: res.state });
});

test('refresh after swipes needs confirm and clears answers', async () => {
  await api.submitSwipe('demo-pick', MOCK_PLACES[0]!.placeId, 2);
  await expect(api.refreshPick('demo-pick')).rejects.toMatchObject({ code: 'CONFIRM_REQUIRED' });
  await api.refreshPick('demo-pick', true);
  expect((await api.getPick('demo-pick')).myAnswers).toEqual({});
});

test('vote: finalists only, changeable, everyone voted -> completed with tie-break', async () => {
  const pick = mockPicks.get('vote-pick')!;
  const finalists = pick.ranking.filter((r) => r.finalist).map((r) => r.placeId);
  await expect(api.vote('vote-pick', MOCK_PLACES[5]!.placeId)).rejects.toMatchObject({
    code: 'INVALID_CANDIDATE',
  });
  await api.vote('vote-pick', finalists[2]!);
  await api.vote('vote-pick', finalists[1]!);
  expect(await mockQueries.getMyVote('vote-pick', MOCK_USER_ID)).toBe(finalists[1]);

  // 2-2 between the #1 and #2 finalists: the better rank (#1) wins on the tie-break.
  const bots = pick.participants.filter((p) => p.userId !== MOCK_USER_ID);
  bots[0]!.vote = finalists[0]!;
  bots[1]!.vote = finalists[0]!;
  bots[2]!.vote = finalists[1]!;
  await api.vote('vote-pick', finalists[1]!); // re-cast triggers the settle check
  const done = await api.getPick('vote-pick');
  expect(done).toMatchObject({
    state: 'completed',
    winnerPlaceId: finalists[0],
    decidedBy: 'tie_break',
  });
});

test('host can close the vote early; a canceled Pick rejects actions', async () => {
  await expect(api.closeVote('vote-pick')).rejects.toMatchObject({ status: 403 }); // Ben hosts
  const { pickId } = await api.createPick(input());
  await api.cancelPick(pickId);
  expect((await api.getPick(pickId)).state).toBe('canceled');
  await expect(api.startPick(pickId)).rejects.toMatchObject({ code: 'INVALID_PICK_STATE' });
});

test('the deadline closes swiping (like the sweep)', async () => {
  const pick = mockPicks.get('demo-pick')!;
  pick.deadlineAt = new Date(Date.now() - 1000).toISOString();
  expect((await api.getProgress('demo-pick')).state).not.toBe('swiping');
});

test('changes notify live subscribers (stands in for Realtime)', async () => {
  const seen = jest.fn();
  const off = subscribeMock('demo-pick', seen);
  await api.submitSwipe('demo-pick', MOCK_PLACES[0]!.placeId, 2);
  expect(seen).toHaveBeenCalled();
  off();
});

test('join codes use the no-lookalikes alphabet', async () => {
  let i = 0;
  const code = makeJoinCode(() => (i++ % 10) / 10);
  expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  await expect(mockQueries.getJoinCode('demo-pick')).resolves.toMatchObject({
    code: expect.stringMatching(/^[A-HJ-NP-Z2-9]{6}$/),
  });
});

test('the final vote has its own deadline, and passing it settles the vote (like the sweep)', async () => {
  const progress = await api.getProgress('vote-pick');
  expect(progress.state).toBe('final_vote');
  expect(Date.parse(progress.deadlineAt ?? '')).toBeGreaterThan(Date.now());

  mockPicks.get('vote-pick')!.voteDeadlineAt = new Date(Date.now() - 1000).toISOString();
  const after = await api.getPick('vote-pick');
  expect(after.state).toBe('completed');
  expect(after.decidedBy).toBe('tie_break'); // no ballots: rank order decides
});
