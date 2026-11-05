import { parseProfileDetails } from '@shared/api/userProfiles.ts';
import type { UserProfilesStore } from '@shared/api/userProfiles.ts';
const mockRpc = jest.fn();
jest.mock('../supabase/functions/api/avatarMetadata.ts', () => ({
  avatarMetadata: jest.fn(async () => ({})),
}));
jest.mock('../supabase/functions/api/serviceClient.ts', () => ({
  createServiceClient: () => ({ rpc: mockRpc }),
}));
const { createUserProfilesStore } = jest.requireActual<{
  createUserProfilesStore(): UserProfilesStore;
}>('../supabase/functions/api/userProfilesStore.ts');
const input = {
  username: ' @Josh_1 ',
  favoriteCuisine: ' Japanese ',
  favoriteActivity: ' Basketball ',
  shareMetadata: false,
};
test('normalizes optional metadata, ignores privilege fields and moderates all visible text', () => {
  expect(parseProfileDetails({ ...input, userId: 'other', avatarUrl: 'ignored' })).toEqual({
    username: 'josh_1',
    favoriteCuisine: 'Japanese',
    favoriteActivity: 'Basketball',
    shareMetadata: false,
  });
  expect(parseProfileDetails({ username: '', favoriteCuisine: ' ', shareMetadata: true })).toEqual({
    username: null,
    favoriteCuisine: null,
    favoriteActivity: null,
    shareMetadata: true,
  });
  for (const field of ['username', 'favoriteCuisine', 'favoriteActivity'])
    expect(() => parseProfileDetails({ ...input, [field]: 'fuck' })).toThrow('isn’t allowed');
});
test.each([
  null,
  [],
  {},
  { ...input, username: 'ab' },
  { ...input, username: 'x'.repeat(25) },
  { ...input, username: 'not allowed' },
  { ...input, favoriteCuisine: 'a'.repeat(61) },
  { ...input, favoriteActivity: 'Line\nbreak' },
  { ...input, shareMetadata: 'yes' },
])('rejects invalid details %p', (body) => expect(() => parseProfileDetails(body)).toThrow());
test('adapter uses verified identities and maps username conflicts safely', async () => {
  mockRpc.mockResolvedValue({ data: { id: 'me' }, error: null });
  const store = createUserProfilesStore();
  await store.get('me', 'friend');
  expect(mockRpc).toHaveBeenLastCalledWith('user_profile_get', {
    p_viewer_id: 'me',
    p_target_id: 'friend',
  });
  await store.update('me', parseProfileDetails(input));
  expect(mockRpc.mock.lastCall[1]).toMatchObject({
    p_user_id: 'me',
    p_input: { username: 'josh_1' },
  });
  mockRpc.mockResolvedValue({ data: null, error: { code: '23505', message: 'PRIVATE SQL' } });
  await expect(store.update('me', parseProfileDetails(input))).rejects.toMatchObject({
    status: 409,
    code: 'USERNAME_TAKEN',
  });
  await expect(store.update('me', parseProfileDetails(input))).rejects.not.toThrow('PRIVATE');
});
test.each([
  ['PT404', 404],
  ['PGRST202', 503],
  ['PT400', 400],
])('adapter sanitizes %s', (code, status) => {
  mockRpc.mockResolvedValue({ data: null, error: { code, message: 'SECRET' } });
  return expect(createUserProfilesStore().get('me', 'friend')).rejects.toMatchObject({ status });
});

test('photo references are additive, revision is owner-only, and legacy avatar URL remains unchanged', async () => {
  const { avatarMetadata } = jest.requireMock<{ avatarMetadata: jest.Mock }>(
    '../supabase/functions/api/avatarMetadata.ts',
  );
  avatarMetadata.mockResolvedValueOnce({
    me: { revision: 4, avatarRef: { userId: 'me', revision: 4 } },
  });
  mockRpc.mockResolvedValueOnce({
    data: { id: 'me', isOwner: true, avatarUrl: null },
    error: null,
  });
  await expect(createUserProfilesStore().get('me', 'me')).resolves.toMatchObject({
    avatarUrl: null,
    avatarRef: { userId: 'me', revision: 4 },
    avatarRevision: 4,
  });
  avatarMetadata.mockResolvedValueOnce({ friend: { revision: 7, avatarRef: null } });
  mockRpc.mockResolvedValueOnce({
    data: { id: 'friend', isOwner: false, avatarUrl: 'https://example.com/legacy.jpg' },
    error: null,
  });
  const profile = await createUserProfilesStore().get('me', 'friend');
  expect(profile.avatarUrl).toBe('https://example.com/legacy.jpg');
  expect(profile.avatarRef).toBeNull();
  expect(profile).not.toHaveProperty('avatarRevision');
});
