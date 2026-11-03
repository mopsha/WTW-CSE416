import { createApiClient } from '@/lib/api';
import { hasRequiredIdentity, parseIdentity } from '@shared/api/userProfiles.ts';
import { mockAuth, MOCK_ACCESS_TOKEN, MOCK_CODE } from '@/lib/mock/auth';
import { MOCK_API_BASE_URL, mockFetch } from '@/lib/mock/api';
const api = createApiClient({
  baseUrl: MOCK_API_BASE_URL,
  getAccessToken: async () => MOCK_ACCESS_TOKEN,
  fetch: mockFetch,
});
afterEach(async () => {
  await mockAuth.signOut();
});
test('unknown login cannot silently create an account; explicit signup can', async () => {
  await expect(mockAuth.sendCode('new-identity@example.com', 'login')).rejects.toThrow(
    'choose Sign Up',
  );
  await expect(mockAuth.verifyCode('new-identity@example.com', MOCK_CODE)).rejects.toThrow();
  await mockAuth.sendCode('new-identity@example.com', 'signup');
  await mockAuth.verifyCode('new-identity@example.com', MOCK_CODE);
  expect(await api.getMe()).toMatchObject({
    displayName: null,
    username: null,
    optionalSetupPending: true,
  });
  await expect(api.completeIdentity('Josh', '@AVA')).rejects.toMatchObject({
    status: 409,
    code: 'USERNAME_TAKEN',
  });
  expect((await api.getMe()).displayName).toBeNull();
  await api.completeIdentity(' Josh ', '@Josh_New');
  const me = await api.getMe();
  expect(me).toMatchObject({
    displayName: 'Josh',
    username: 'josh_new',
    optionalSetupPending: true,
    onboarded: false,
  });
  // Optional completion and Discover survey do not participate in the identity guard.
  expect(hasRequiredIdentity(me.displayName, me.username)).toBe(true);
  await api.finishOptionalSetup();
  await api.finishOptionalSetup();
  await mockAuth.signOut();
  await mockAuth.sendCode('new-identity@example.com', 'login');
  await mockAuth.verifyCode('new-identity@example.com', MOCK_CODE);
  expect(await api.getMe()).toMatchObject({ username: 'josh_new', optionalSetupPending: false });
});
test('returning demo account skips both setup flows and identity does not leak between emails', async () => {
  await mockAuth.sendCode('demo@wtw.test', 'login');
  await mockAuth.verifyCode('demo@wtw.test', MOCK_CODE);
  expect(await api.getMe()).toMatchObject({
    displayName: 'Demo',
    username: 'demo',
    optionalSetupPending: false,
  });
  await mockAuth.signOut();
  await mockAuth.sendCode('second@example.com', 'signup');
  await mockAuth.verifyCode('second@example.com', MOCK_CODE);
  expect(await api.getMe()).toMatchObject({
    displayName: null,
    username: null,
    optionalSetupPending: true,
  });
});
test('unfinished identity/optional setup survives logout and login; deletion removes mock account', async () => {
  await mockAuth.sendCode('resume@example.com', 'signup');
  await mockAuth.verifyCode('resume@example.com', MOCK_CODE);
  await api.completeIdentity('Resume', 'resume_person');
  await mockAuth.signOut();
  await mockAuth.sendCode('resume@example.com', 'login');
  await mockAuth.verifyCode('resume@example.com', MOCK_CODE);
  expect(await api.getMe()).toMatchObject({
    username: 'resume_person',
    optionalSetupPending: true,
  });
  await api.deleteMe();
  await mockAuth.signOut();
  await expect(mockAuth.sendCode('resume@example.com', 'login')).rejects.toThrow();
});
test('identity parser uses existing normalization and requires both fields for legacy completion', () => {
  expect(parseIdentity({ displayName: ' Josh ', username: '@JoSh_1' })).toEqual({
    displayName: 'Josh',
    username: 'josh_1',
  });
  for (const body of [
    { displayName: 'Josh' },
    { displayName: '', username: 'josh' },
    { displayName: 'Josh', username: 'bad name' },
  ])
    expect(() => parseIdentity(body)).toThrow();
  expect(hasRequiredIdentity('Legacy', null)).toBe(false);
  expect(hasRequiredIdentity(null, 'legacy')).toBe(false);
  expect(hasRequiredIdentity('Legacy', 'legacy')).toBe(true);
});

test('username uniqueness also covers other signed-out mock accounts', async () => {
  await mockAuth.sendCode('first-unique@example.com', 'signup');
  await mockAuth.verifyCode('first-unique@example.com', MOCK_CODE);
  await api.completeIdentity('First', 'globally_unique');
  await mockAuth.signOut();
  await mockAuth.sendCode('second-unique@example.com', 'signup');
  await mockAuth.verifyCode('second-unique@example.com', MOCK_CODE);
  await expect(api.completeIdentity('Second', 'globally_unique')).rejects.toMatchObject({
    status: 409,
  });
  expect((await api.getMe()).displayName).toBeNull();
});
