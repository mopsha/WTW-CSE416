import { createApiClient } from '@/lib/api';
import { mockFetch, MOCK_API_BASE_URL } from '@/lib/mock/api';
import { MOCK_ACCESS_TOKEN } from '@/lib/mock/auth';
import { DEMO_CENTER } from '@/lib/mock/fixtures';
import { mockPicks, resetMockData, setMockBots, maybeSettleVote } from '@/lib/mock/store';
import { mockGroupIdeas, resetMockGroups } from '@/lib/mock/groups';
import { resetMockFriends } from '@/lib/mock/friends';
const api = createApiClient({
  baseUrl: MOCK_API_BASE_URL,
  getAccessToken: async () => MOCK_ACCESS_TOKEN,
  fetch: mockFetch,
});
const groupId = 'mock-group-roommates';
const input = {
  category: 'food' as const,
  center: DEMO_CENTER,
  radiusM: 5000,
  poolSize: 5,
  closeThreshold: 100,
  deadlineAt: null,
};
beforeEach(() => {
  resetMockData();
  resetMockGroups();
  resetMockFriends();
  setMockBots(false);
});
afterAll(() => setMockBots(true));
test('OFF is unchanged; ON filters by type, snapshots survive edits/deletion and an idea wins normal final vote', async () => {
  const food = await api.createGroupIdea(groupId, {
    name: 'Cook together',
    category: 'food',
    locationText: 'Our kitchen',
  });
  await api.createGroupIdea(groupId, { name: 'Catan', category: 'activity' });
  const off = await api.createGroupPick(input, groupId);
  await api.startPick(off.pickId);
  expect((await api.getPick(off.pickId)).candidates.every((c) => !c.origin)).toBe(true);
  const on = await api.createGroupPick({ ...input, includeGroupIdeas: true }, groupId);
  const pick = mockPicks.get(on.pickId)!;
  await api.startPick(on.pickId);
  const before = await api.getPick(on.pickId);
  expect(before.includeGroupIdeas).toBe(true);
  const ourIdea = before.candidates.find((c) => c.origin === 'group_idea')!;
  expect(ourIdea).toMatchObject({
    name: 'Cook together',
    groupIdeaId: food.id,
    lat: null,
    lng: null,
  });
  expect(before.candidates.some((c) => c.name === 'Catan')).toBe(false);
  expect(before.candidates.some((c) => !c.origin)).toBe(true);
  await api.updateGroupIdea(groupId, food.id, { name: 'New dinner', category: 'food' });
  await api.deleteGroupIdea(groupId, food.id);
  expect(
    (await api.getPick(on.pickId)).candidates.find((c) => c.placeId === ourIdea.placeId),
  ).toEqual(ourIdea);
  for (const p of pick.participants) for (const c of pick.candidates) p.answers.set(c.placeId, 1);
  await api.closePick(on.pickId);
  expect(pick.state).toBe('final_vote');
  expect(pick.ranking.find((r) => r.placeId === ourIdea.placeId)?.finalist).toBe(true);
  for (const p of pick.participants) p.vote = ourIdea.placeId;
  await api.vote(on.pickId, ourIdea.placeId);
  maybeSettleVote(pick);
  expect(pick.state).toBe('completed');
  expect(pick.winnerPlaceId).toBe(ourIdea.placeId);
  const again = await api.pickAgain(on.pickId);
  expect((await api.getPick(again.pickId)).includeGroupIdeas).toBe(true);
  expect((await api.pickAgain(on.pickId)).pickId).toBe(again.pickId);
  await api.startPick(again.pickId);
  expect((await api.getPick(again.pickId)).candidates.some((c) => c.origin)).toBe(false); // deleted library entry
  expect(
    (await api.getPick(on.pickId)).candidates.find((c) => c.placeId === ourIdea.placeId),
  ).toEqual(ourIdea);
});
test('former member cannot build a deck, including opt-in Picks with no ideas', async () => {
  const g = 'mock-group-climbing';
  const p = await api.createGroupPick({ ...input, includeGroupIdeas: true }, g);
  await api.leaveGroup(g);
  await expect(api.startPick(p.pickId)).rejects.toMatchObject({ status: 404 });
  expect(mockPicks.get(p.pickId)!.candidates).toEqual([]);
});
test('refresh uses new IDs/current content, while Custom typed options and both idea types coexist', async () => {
  await api.createGroupIdea(groupId, { name: 'Dinner', category: 'food' });
  const activity = await api.createGroupIdea(groupId, { name: 'Catan', category: 'activity' });
  const p = await api.createGroupPick(
    {
      ...input,
      category: 'custom',
      poolSize: 10,
      includeGroupIdeas: true,
      customOptions: [{ name: 'Movie' }, { name: 'Study' }],
    },
    groupId,
  );
  await api.startPick(p.pickId);
  const old = (await api.getPick(p.pickId)).candidates;
  expect(old.map((c) => c.name)).toEqual(
    expect.arrayContaining(['Movie', 'Study', 'Dinner', 'Catan']),
  );
  await api.updateGroupIdea(groupId, activity.id, { name: 'Basketball', category: 'activity' });
  await api.refreshPick(p.pickId);
  const current = (await api.getPick(p.pickId)).candidates;
  expect(current.find((c) => c.groupIdeaId === activity.id)!.name).toBe('Basketball');
  expect(current.find((c) => c.groupIdeaId === activity.id)!.placeId).not.toBe(
    old.find((c) => c.groupIdeaId === activity.id)!.placeId,
  );
  expect(old.find((c) => c.groupIdeaId === activity.id)!.name).toBe('Catan');
  expect(mockGroupIdeas.size).toBe(2);
});

test('Both queries food/activity fixtures and includes both idea types; OFF remains provider only', async () => {
  await api.createGroupIdea(groupId, { name: 'Dinner together', category: 'food' });
  await api.createGroupIdea(groupId, { name: 'Basketball', category: 'activity' });
  const on = await api.createGroupPick(
    { ...input, category: 'both', poolSize: 10, includeGroupIdeas: true },
    groupId,
  );
  await api.startPick(on.pickId);
  const places = (await api.getPick(on.pickId)).candidates;
  expect(places.filter((p) => p.origin).map((p) => p.name)).toEqual(
    expect.arrayContaining(['Dinner together', 'Basketball']),
  );
  expect(places.some((p) => p.placeId.startsWith('mock-place-'))).toBe(true);
  expect(places.some((p) => p.placeId.startsWith('sbu-act-'))).toBe(true);
  const off = await api.createGroupPick({ ...input, category: 'both' }, groupId);
  await api.startPick(off.pickId);
  const publicOnly = (await api.getPick(off.pickId)).candidates;
  expect(publicOnly.some((p) => p.origin)).toBe(false);
  expect(publicOnly.some((p) => p.placeId.startsWith('mock-place-'))).toBe(true);
  expect(publicOnly.some((p) => p.placeId.startsWith('sbu-act-'))).toBe(true);
});

test('coordinate-free ideas survive Free/Open Now/radius filters when no public places match', async () => {
  await api.createGroupIdea(groupId, { name: 'Cards at home', category: 'activity' });
  await api.createGroupIdea(groupId, { name: 'Dinner', category: 'food' });
  const { pickId } = await api.createGroupPick(
    {
      ...input,
      category: 'activities',
      includeGroupIdeas: true,
      center: { lat: 0, lng: 0 },
      radiusM: 200,
      priceMax: 0,
      openNow: true,
    },
    groupId,
  );
  await api.startPick(pickId);
  const deck = (await api.getPick(pickId)).candidates;
  expect(deck.map((p) => p.name)).toEqual(['Cards at home']);
  expect(deck[0]).toMatchObject({ lat: null, lng: null, locationProvided: false });
});
test('a new Pick Again disables ideas after host leaves the group', async () => {
  const g = 'mock-group-climbing';
  const original = await api.createGroupPick({ ...input, includeGroupIdeas: true }, g);
  await api.cancelPick(original.pickId);
  await api.leaveGroup(g);
  const next = await api.pickAgain(original.pickId);
  expect((await api.getPick(next.pickId)).includeGroupIdeas).toBe(false);
});
