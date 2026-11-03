import { createApiClient } from '@/lib/api';
import { MOCK_ACCESS_TOKEN } from '@/lib/mock/auth';
import { mockFetch, MOCK_API_BASE_URL } from '@/lib/mock/api';
import { resetMockData, setMockBots } from '@/lib/mock/store';
import { resetMockFriends } from '@/lib/mock/friends';
const api = createApiClient({
  baseUrl: MOCK_API_BASE_URL,
  getAccessToken: async () => MOCK_ACCESS_TOKEN,
  fetch: mockFetch,
});
beforeEach(() => {
  resetMockData();
  resetMockFriends();
  setMockBots(false);
});
afterAll(() => setMockBots(true));
test('blocked-list/unblock reflect current own blocks without restoring friendship/profile access', async () => {
  expect(await api.listBlockedUsers()).toEqual({ users: [] });
  await api.blockUser('mock-ava');
  expect(await api.listBlockedUsers()).toEqual({
    users: [{ userId: 'mock-ava', displayName: 'Ava' }],
  });
  await expect(api.getUserProfile('mock-ava')).rejects.toMatchObject({ status: 404 });
  await api.unblockUser('mock-ava');
  expect(await api.listBlockedUsers()).toEqual({ users: [] });
  expect((await api.listFriends()).friends.some((p) => p.userId === 'mock-ava')).toBe(false);
  await expect(api.getUserProfile('mock-ava')).rejects.toMatchObject({ status: 404 });
});
test('blocked list requires authentication', async () => {
  const anon = createApiClient({
    baseUrl: MOCK_API_BASE_URL,
    getAccessToken: async () => null,
    fetch: mockFetch,
  });
  await expect(anon.listBlockedUsers()).rejects.toMatchObject({ status: 401 });
});
