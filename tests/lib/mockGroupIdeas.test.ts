import { createApiClient } from '@/lib/api';
import { MOCK_API_BASE_URL, mockFetch } from '@/lib/mock/api';
import { MOCK_ACCESS_TOKEN, MOCK_USER_ID } from '@/lib/mock/auth';
import { mockGroupIdeas, resetMockGroups } from '@/lib/mock/groups';
import { mockPicks, resetMockData, setMockBots } from '@/lib/mock/store';
const api = createApiClient({
  baseUrl: MOCK_API_BASE_URL,
  getAccessToken: async () => MOCK_ACCESS_TOKEN,
  fetch: mockFetch,
});
const group = 'mock-group-roommates';
const other = 'mock-group-climbing';
const input = {
  name: 'Catan at John’s',
  category: 'activity' as const,
  description: 'Bring snacks',
  locationText: 'John’s house',
};
beforeEach(() => {
  resetMockGroups();
  resetMockData();
  setMockBots(false);
});
afterAll(() => setMockBots(true));
test('client/mock CRUD preserves creator, group and timestamps without creating a Pick', async () => {
  expect(await api.listGroupIdeas(group)).toEqual({ ideas: [] });
  const pickCount = mockPicks.size;
  const idea = await api.createGroupIdea(group, input);
  expect(idea).toMatchObject({ ...input, groupId: group, createdBy: MOCK_USER_ID });
  expect(await api.getGroupIdea(group, idea.id)).toEqual(idea);
  expect((await api.listGroupIdeas(other)).ideas).toEqual([]);
  const edited = await api.updateGroupIdea(group, idea.id, { name: 'Dinner', category: 'food' });
  expect(edited).toMatchObject({
    name: 'Dinner',
    category: 'food',
    description: null,
    locationText: null,
    createdAt: idea.createdAt,
    createdBy: MOCK_USER_ID,
  });
  expect((await api.listGroupIdeas(group)).ideas).toEqual([edited]);
  await api.deleteGroupIdea(group, idea.id);
  await expect(api.getGroupIdea(group, idea.id)).rejects.toMatchObject({ status: 404 });
  expect(mockPicks.size).toBe(pickCount);
});
test('outsiders, cross-group IDs and former members cannot read or mutate', async () => {
  const idea = await api.createGroupIdea(other, input);
  await expect(api.getGroupIdea(group, idea.id)).rejects.toMatchObject({ status: 404 });
  await expect(api.updateGroupIdea(group, idea.id, input)).rejects.toMatchObject({ status: 404 });
  await api.leaveGroup(other);
  for (const op of [
    () => api.listGroupIdeas(other),
    () => api.getGroupIdea(other, idea.id),
    () => api.createGroupIdea(other, input),
    () => api.updateGroupIdea(other, idea.id, input),
    () => api.deleteGroupIdea(other, idea.id),
  ])
    await expect(op()).rejects.toMatchObject({ status: 404 });
  await expect(api.listGroupIdeas('unknown')).rejects.toMatchObject({ status: 404 });
});
test('creator-only editing; owner moderation; other members cannot delete', async () => {
  const owned = await api.createGroupIdea(group, input);
  mockGroupIdeas.set(owned.id, { ...owned, createdBy: 'mock-ava' });
  await expect(api.updateGroupIdea(group, owned.id, input)).rejects.toMatchObject({ status: 403 });
  await expect(api.deleteGroupIdea(group, owned.id)).resolves.toEqual({ status: 'ok' });
  const foreign = await api.createGroupIdea(other, input);
  mockGroupIdeas.set(foreign.id, { ...foreign, createdBy: 'mock-cam' });
  await expect(api.updateGroupIdea(other, foreign.id, input)).rejects.toMatchObject({
    status: 403,
  });
  await expect(api.deleteGroupIdea(other, foreign.id)).rejects.toMatchObject({ status: 403 });
});
test('validation/auth match real API and group deletion cascades', async () => {
  await expect(api.createGroupIdea(group, { ...input, name: 'fuck' })).rejects.toMatchObject({
    code: 'TEXT_NOT_ALLOWED',
  });
  const idea = await api.createGroupIdea(group, input);
  await api.deleteGroup(group);
  expect(mockGroupIdeas.has(idea.id)).toBe(false);
  const anon = createApiClient({
    baseUrl: MOCK_API_BASE_URL,
    getAccessToken: async () => null,
    fetch: mockFetch,
  });
  await expect(anon.listGroupIdeas(other)).rejects.toMatchObject({ status: 401 });
});

test('account deletion removes created ideas and ideas in owned groups', async () => {
  const own = await api.createGroupIdea(group, input);
  mockGroupIdeas.set(own.id, { ...own, createdBy: 'mock-ava' });
  await api.createGroupIdea(other, input);
  await api.deleteMe();
  expect(mockGroupIdeas.size).toBe(0);
});
