// The mock's /friends routes follow the API's contract through the real API client.
import { ApiError, createApiClient } from '@/lib/api';
import { MOCK_ACCESS_TOKEN } from '@/lib/mock/auth';
import { MOCK_API_BASE_URL, mockFetch } from '@/lib/mock/api';
import { resetMockFriends } from '@/lib/mock/friends';

const api = createApiClient({
  baseUrl: MOCK_API_BASE_URL,
  getAccessToken: async () => MOCK_ACCESS_TOKEN,
  fetch: mockFetch,
});

beforeEach(() => resetMockFriends());

const names = (people: { displayName: string | null }[]) => people.map((p) => p.displayName);

test('starts with Ava, Ben and Cam as friends and one request from Jordan', async () => {
  const list = await api.listFriends();
  expect(names(list.friends).sort()).toEqual(['Ava', 'Ben', 'Cam']);
  expect(names(list.incoming)).toEqual(['Jordan']);
});

test('accept moves a request into friends; decline removes it', async () => {
  await expect(api.acceptFriend('mock-jordan')).resolves.toEqual({ status: 'accepted' });
  let list = await api.listFriends();
  expect(names(list.friends)[0]).toBe('Jordan');
  expect(list.incoming).toEqual([]);

  await api.removeFriend('mock-jordan');
  list = await api.listFriends();
  expect(names(list.friends)).not.toContain('Jordan');
});

test('a sent request is not listed, so the list cannot reveal who has an account', async () => {
  await expect(api.addFriend('Dana.Lee@example.com')).resolves.toEqual({ status: 'sent' });
  expect(JSON.stringify(await api.listFriends())).not.toContain('Dana');
});

test('errors match the API', async () => {
  // Same answer for an email with no account, so the route can't find out who uses WTW.
  await expect(api.addFriend('nobody@example.com')).resolves.toEqual({ status: 'sent' });
  await expect(api.addFriend('not an email')).rejects.toBeInstanceOf(ApiError);
  await expect(api.acceptFriend('mock-ava-nope')).rejects.toMatchObject({
    code: 'REQUEST_NOT_FOUND',
  });
});
