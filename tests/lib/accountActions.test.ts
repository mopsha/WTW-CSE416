import { createAccountActions } from '@/lib/accountActions';
jest.mock('@/lib/auth', () => ({ auth: { signOut: jest.fn() } }));
jest.mock('@/lib/api', () => ({ api: { deleteMe: jest.fn() } }));
jest.mock('@/lib/confirm', () => ({ confirmAction: jest.fn() }));
jest.mock('@/lib/push', () => ({ unregisterFromPush: jest.fn() }));
function setup() {
  const calls: string[] = [];
  const deps = {
    unregisterPush: jest.fn(async () => {
      calls.push('push');
    }),
    signOut: jest.fn(async () => {
      calls.push('signOut');
    }),
    deleteAccount: jest.fn(async () => {
      calls.push('delete');
    }),
    confirmDelete: jest.fn(async () => {
      calls.push('confirm');
      return true;
    }),
  };
  return { deps, calls, actions: createAccountActions(deps) };
}
test('logout attempts push cleanup before existing auth signout, even when cleanup fails', async () => {
  const { deps, calls, actions } = setup();
  await actions.logOut();
  expect(calls).toEqual(['push', 'signOut']);
  deps.unregisterPush.mockRejectedValue(new Error('offline'));
  await expect(actions.logOut()).resolves.toBeUndefined();
  expect(deps.signOut).toHaveBeenCalledTimes(2);
});
test('cancelled deletion never deletes or signs out', async () => {
  const { deps, actions } = setup();
  deps.confirmDelete.mockResolvedValue(false);
  expect(await actions.deleteAccount()).toBe(false);
  expect(deps.deleteAccount).not.toHaveBeenCalled();
  expect(deps.signOut).not.toHaveBeenCalled();
});
test('confirmed deletion completes backend deletion before signout', async () => {
  const { calls, actions } = setup();
  expect(await actions.deleteAccount()).toBe(true);
  expect(calls).toEqual(['confirm', 'delete', 'signOut']);
});
test('failed deletion retains session and allows retry', async () => {
  const { deps, actions } = setup();
  deps.deleteAccount.mockRejectedValueOnce(new Error('API failure'));
  await expect(actions.deleteAccount()).rejects.toThrow('API failure');
  expect(deps.signOut).not.toHaveBeenCalled();
  await expect(actions.deleteAccount()).resolves.toBe(true);
});
test('duplicate taps cannot run concurrent account actions', async () => {
  const { deps, actions } = setup();
  let resolve!: () => void;
  deps.unregisterPush.mockReturnValue(
    new Promise<void>((r) => {
      resolve = r;
    }),
  );
  const first = actions.logOut();
  await expect(actions.deleteAccount()).rejects.toThrow('in progress');
  expect(deps.confirmDelete).not.toHaveBeenCalled();
  resolve();
  await first;
});
test('signout failures surface honestly, including after successful deletion', async () => {
  const { deps, actions } = setup();
  deps.signOut.mockRejectedValue(new Error('signout failed'));
  await expect(actions.logOut()).rejects.toThrow('signout failed');
  await expect(actions.deleteAccount()).rejects.toThrow('account was deleted');
});

test('mock logout clears session and emits the auth change used by navigation guards', async () => {
  const { mockAuth, MOCK_CODE } =
    jest.requireActual<typeof import('@/lib/mock/auth')>('@/lib/mock/auth');
  await mockAuth.sendCode('settings-test@example.com', 'signup');
  await mockAuth.verifyCode('settings-test@example.com', MOCK_CODE);
  expect(await mockAuth.getSession()).not.toBeNull();
  const events: unknown[] = [];
  const unsubscribe = mockAuth.onChange((session) => events.push(session));
  const actions = createAccountActions({
    unregisterPush: async () => {},
    signOut: () => mockAuth.signOut(),
    deleteAccount: async () => {},
    confirmDelete: async () => false,
  });
  await actions.logOut();
  expect(await mockAuth.getSession()).toBeNull();
  expect(events).toEqual([null]);
  unsubscribe();
});
