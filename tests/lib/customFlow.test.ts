import { createApiClient } from '@/lib/api';
import { mockFetch, MOCK_API_BASE_URL } from '@/lib/mock/api';
import { MOCK_ACCESS_TOKEN, MOCK_USER_ID } from '@/lib/mock/auth';
import { DEMO_CENTER, MOCK_PLACES } from '@/lib/mock/fixtures';
import { mockPicks, resetMockData, setMockBots, maybeSettleVote } from '@/lib/mock/store';
import { savedPlaces } from '@/lib/mock/saved';
const api = createApiClient({
  baseUrl: MOCK_API_BASE_URL,
  getAccessToken: async () => MOCK_ACCESS_TOKEN,
  fetch: mockFetch,
});
beforeEach(() => {
  setMockBots(false);
  resetMockData();
  savedPlaces.clear();
});
afterAll(() => {
  resetMockData();
});
test('a Custom Pick with 4 typed options completes existing swipe → rank → final vote → winner flow', async () => {
  const { pickId } = await api.createPick({
    category: 'custom',
    center: DEMO_CENTER,
    radiusM: 5000,
    poolSize: 4,
    deadlineAt: null,
    closeThreshold: 100,
    customOptions: ['Game night', 'Basketball', 'Study session', 'Movie night'].map((name) => ({
      name,
      note: 'Bring friends',
    })),
  });
  const pick = mockPicks.get(pickId)!;
  const friend = {
    userId: 'friend',
    name: 'Friend',
    answers: new Map<string, 0 | 1 | 2>(),
    vote: null as string | null,
  };
  pick.participants.push(friend);
  await api.startPick(pickId);
  expect(pick.candidates).toHaveLength(4);
  expect(
    pick.candidates.every((c) => c.provider === 'custom' && c.createdBy === MOCK_USER_ID),
  ).toBe(true);
  const ids = pick.candidates.map((c) => c.placeId);
  await api.refreshPick(pickId);
  expect(pick.candidates.map((c) => c.placeId)).toEqual(ids);
  const visible = await api.getPick(pickId);
  expect(
    visible.candidates.every((c) => c.lat === null && c.lng === null && c.note === 'Bring friends'),
  ).toBe(true);
  for (const id of ids) friend.answers.set(id, 1);
  for (const id of ids) await api.submitSwipe(pickId, id, 1);
  expect(pick.state).toBe('final_vote');
  expect(pick.ranking.every((r) => !('score' in r))).toBe(true);
  const finalist = pick.ranking.find((r) => r.finalist)!.placeId;
  friend.vote = finalist;
  await api.vote(pickId, finalist);
  maybeSettleVote(pick);
  expect((await api.getPick(pickId)).state).toBe('completed');
  expect(pick.winnerPlaceId).toBe(finalist);
});
test('saved inside radius precedes provider results, outside radius excluded, disabled flag preserves defaults', async () => {
  await api.savePlace('sbu-food-13'); // farther from campus than the closest provider result
  await api.savePlace('sbu-act-13'); // outside 5 km
  const { pickId } = await api.createPick({
    category: 'food',
    center: DEMO_CENTER,
    radiusM: 5000,
    poolSize: 5,
    deadlineAt: null,
    closeThreshold: 100,
    includeSaved: true,
  });
  const pick = mockPicks.get(pickId)!;
  pick.participants.push({ userId: 'friend', name: 'Friend', answers: new Map(), vote: null });
  await api.startPick(pickId);
  expect(pick.candidates[0]!.placeId).toBe(MOCK_PLACES[12]!.placeId);
  expect(pick.candidates.some((p) => p.placeId === 'sbu-act-13')).toBe(false);
  expect(new Set(pick.candidates.map((p) => p.placeId)).size).toBe(5);
  pick.poolSize = 20;
  await api.refreshPick(pickId);
  expect(pick.candidates.filter((p) => p.name === MOCK_PLACES[12]!.name)).toHaveLength(1);
});
