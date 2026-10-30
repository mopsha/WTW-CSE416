// The mock's POST /me follows the API's rules through the real API client, and the name
// then shows up where friends see me (progress), like profiles.display_name does.
import { createApiClient } from '@/lib/api';
import { suggestedName } from '@/hooks/useProfile';
import { MOCK_ACCESS_TOKEN, MOCK_USER_ID } from '@/lib/mock/auth';
import { MOCK_API_BASE_URL, mockFetch } from '@/lib/mock/api';
import { mockQueries } from '@/lib/mock/queries';
import { EMPTY_PREFERENCES } from '@shared/domain/preferences.ts';
import {
  mockPicks,
  mockProfile,
  progressOf,
  resetMockData,
  resetMockProfile,
  setMockBots,
} from '@/lib/mock/store';

const api = createApiClient({
  baseUrl: MOCK_API_BASE_URL,
  getAccessToken: async () => MOCK_ACCESS_TOKEN,
  fetch: mockFetch,
});

beforeEach(() => {
  setMockBots(false);
  resetMockData();
  resetMockProfile();
});

test('a new mock account has no name, so the app asks for one', async () => {
  await expect(mockQueries.getMyProfile(MOCK_USER_ID)).resolves.toEqual({ displayName: null });
});

test('saving a name trims it, reads back, and shows in Pick progress', async () => {
  await expect(api.updateMe('  Mike  ')).resolves.toEqual({ displayName: 'Mike' });
  await expect(mockQueries.getMyProfile(MOCK_USER_ID)).resolves.toEqual({ displayName: 'Mike' });
  const pick = [...mockPicks.values()].find((p) =>
    p.participants.some((x) => x.userId === MOCK_USER_ID),
  )!;
  expect(progressOf(pick).participants.find((p) => p.isMe)?.displayName).toBe('Mike');
});

test('bad names fail with 400 INVALID_INPUT like the server and change nothing', async () => {
  for (const name of ['', '   ', 'a'.repeat(51), 'two\nlines']) {
    await expect(api.updateMe(name)).rejects.toMatchObject({ status: 400, code: 'INVALID_INPUT' });
  }
  expect(mockProfile.displayName).toBeNull();
});

test('the name step is prefilled from the email local part', () => {
  expect(suggestedName('jane.doe@stonybrook.edu')).toBe('jane.doe');
  expect(suggestedName('x'.repeat(60) + '@a.b')).toHaveLength(50);
  expect(suggestedName(null)).toBe('');
});

test('a new mock account has not finished onboarding (GET /me)', async () => {
  await expect(api.getMe()).resolves.toEqual({
    displayName: null,
    preferences: EMPTY_PREFERENCES,
    onboarded: false,
  });
});

test('saving the survey marks onboarding done and reads back', async () => {
  const preferences = { ...EMPTY_PREFERENCES, categories: ['food' as const], priceMax: 2 };
  await expect(api.savePreferences(preferences)).resolves.toEqual({ preferences, onboarded: true });
  await expect(api.getMe()).resolves.toMatchObject({ preferences, onboarded: true });
});

test('bad survey answers fail with 400 INVALID_INPUT like the server and change nothing', async () => {
  await expect(api.savePreferences({ ...EMPTY_PREFERENCES, priceMax: 9 })).rejects.toMatchObject({
    status: 400,
    code: 'INVALID_INPUT',
  });
  expect(mockProfile.onboarded).toBe(false);
});

test('push tokens are validated and stored once', async () => {
  await api.registerPushToken('ExponentPushToken[abc]', 'ios');
  await api.registerPushToken('ExponentPushToken[abc]', 'ios');
  expect(mockProfile.pushTokens).toEqual(['ExponentPushToken[abc]']);
  await expect(api.registerPushToken('', 'android')).rejects.toMatchObject({ status: 400 });
});

test('DELETE /me leaves a brand-new account behind', async () => {
  await api.updateMe('Mike');
  await api.savePreferences({ ...EMPTY_PREFERENCES, priceMax: 1 });
  await api.deleteMe();
  await expect(api.getMe()).resolves.toEqual({
    displayName: null,
    preferences: EMPTY_PREFERENCES,
    onboarded: false,
  });
});
