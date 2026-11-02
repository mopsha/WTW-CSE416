import { createApiClient } from '@/lib/api';
import { MOCK_API_BASE_URL, mockFetch, mockNotifications } from '@/lib/mock/api';
import { MOCK_ACCESS_TOKEN, MOCK_USER_ID } from '@/lib/mock/auth';
import { mockHang, mockHangPosts, mockHangResponses, resetMockHang } from '@/lib/mock/hang';
import { mockPicks, resetMockData, setMockBots } from '@/lib/mock/store';
import { resetMockGroups } from '@/lib/mock/groups';
import { resetMockFriends } from '@/lib/mock/friends';
import type { HangPost } from '@shared/api/hang.ts';
const api = createApiClient({
  baseUrl: MOCK_API_BASE_URL,
  getAccessToken: async () => MOCK_ACCESS_TOKEN,
  fetch: mockFetch,
});
const input = {
  activity: 'Game night',
  audience: 'all_friends' as const,
  groupId: null,
  startsAt: new Date(Date.now() + 3600000).toISOString(),
  expiresAt: new Date(Date.now() + 7200000).toISOString(),
};
const settings = {
  category: 'food' as const,
  center: { lat: 40.9126, lng: -73.1234 },
  radiusM: 5000,
  poolSize: 5,
  deadlineAt: null,
  closeThreshold: 100,
};
beforeEach(() => {
  setMockBots(false);
  resetMockData();
  resetMockGroups();
  resetMockFriends();
  resetMockHang();
});
afterAll(() => setMockBots(true));
const seed = (changes: Partial<HangPost> = {}) => {
  const post = { ...input, id: 'friend-hang', authorId: 'mock-ava', ...changes };
  mockHangPosts.push(post);
  return post;
};
test('accepted friend feed and status replacement, then blocking removes access', async () => {
  const post = seed();
  expect((await api.getHang()).posts.map((p) => p.id)).toContain(post.id);
  await api.respondHang(post.id, 'down');
  await api.respondHang(post.id, 'maybe');
  expect(mockHangResponses.get(post.id)?.size).toBe(1);
  expect((await api.getHang()).posts[0]?.myStatus).toBe('maybe');
  await api.blockUser('mock-ava');
  expect((await api.getHang()).posts).toHaveLength(0);
  await expect(api.respondHang(post.id, 'down')).rejects.toMatchObject({ status: 404 });
});
test('nonfriends, group outsiders and expired posts are hidden and rejected', async () => {
  for (const post of [
    seed({ id: 'outsider', authorId: 'stranger' }),
    seed({ id: 'unknown-group', audience: 'group', groupId: 'unknown' }),
    seed({ id: 'expired', expiresAt: new Date(Date.now() - 1).toISOString() }),
  ])
    await expect(api.respondHang(post.id, 'down')).rejects.toMatchObject({ status: 404 });
  expect((await api.getHang()).posts).toHaveLength(0);
});
test('group posts can be created and members respond until they leave', async () => {
  const own = await api.createHang({ ...input, audience: 'group', groupId: 'mock-group-climbing' });
  expect(own.groupId).toBe('mock-group-climbing');
  const post = seed({ audience: 'group', groupId: 'mock-group-climbing' });
  await api.respondHang(post.id, 'down');
  await api.leaveGroup('mock-group-climbing');
  await expect(api.respondHang(post.id, 'down')).rejects.toMatchObject({ status: 404 });
  // Authors retain access to their own post after leaving, but cannot create a group Pick.
  expect((await api.getHang()).posts.map((p) => p.id)).toContain(own.id);
});
test('exactly eligible down users enter the Pick, no implicit author, repeated taps reuse', async () => {
  const post = await api.createHang(input);
  mockHangResponses.set(
    post.id,
    new Map([
      ['mock-ava', 'down'],
      ['mock-ben', 'down'],
      ['mock-cam', 'maybe'],
      ['mock-jordan', 'cant'],
    ]),
  );
  const notify = jest.fn();
  const response = await mockHang('POST', `/hang/${post.id}/pick`, settings, notify);
  const result = await response!.json();
  expect(result.isParticipant).toBe(false);
  const pick = mockPicks.get(result.pickId)!;
  expect(pick.participants.map((p) => p.userId)).toEqual(['mock-ava', 'mock-ben']);
  expect(pick.hostId).toBe('mock-ava');
  expect(notify).toHaveBeenCalledWith(['mock-ava', 'mock-ben'], pick.id);
  const repeated = await mockHang('POST', `/hang/${post.id}/pick`, settings, notify);
  expect(await repeated!.json()).toEqual(result);
  expect(notify).toHaveBeenCalledTimes(2);
});
test('blocked/removed responders are excluded; no down and nonauthor calls return 4xx', async () => {
  const post = await api.createHang(input);
  await expect(api.hangPick(post.id, settings)).rejects.toMatchObject({
    status: 409,
    code: 'NO_DOWN_RESPONSES',
  });
  mockHangResponses.set(
    post.id,
    new Map([
      ['mock-ava', 'down'],
      ['mock-ben', 'down'],
      ['mock-cam', 'down'],
    ]),
  );
  await api.blockUser('mock-ben');
  await api.removeFriend('mock-cam');
  const result = await api.hangPick(post.id, settings);
  expect(mockPicks.get(result.pickId)!.participants.map((p) => p.userId)).toEqual(['mock-ava']);
  const foreign = seed({ id: 'foreign' });
  await expect(api.hangPick(foreign.id, settings)).rejects.toMatchObject({ status: 403 });
});
test('author included only after answering down, with an existing inbox notification', async () => {
  const post = await api.createHang(input);
  await api.respondHang(post.id, 'down');
  mockHangResponses.get(post.id)!.set('mock-ava', 'down');
  const result = await api.hangPick(post.id, settings);
  await api.hangPick(post.id, settings);
  expect((await api.getPlan(result.pickId)).planAt).toBe(post.startsAt);
  expect(result.isParticipant).toBe(true);
  expect(mockPicks.get(result.pickId)!.hostId).toBe(MOCK_USER_ID);
  expect(
    mockNotifications.filter((n) => n.pickId === result.pickId && n.type === 'added_to_pick'),
  ).toHaveLength(1);
});
