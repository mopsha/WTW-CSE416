import React from 'react';
import { EMPTY_PREFERENCES } from '@shared/domain/preferences.ts';
import { ProfileProvider, useProfile } from '@/hooks/useProfile';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';

jest.mock('@/hooks/useAuth', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/api', () => ({ api: { getMe: jest.fn() } }));
const { create, act } = jest.requireActual('react-test-renderer');
let profile!: ReturnType<typeof useProfile>;
function Consumer() {
  const value = useProfile();
  React.useEffect(() => {
    profile = value;
  }, [value]);
  return null;
}
const me = {
  displayName: 'Returning',
  username: 'returning',
  optionalSetupPending: false,
  preferences: EMPTY_PREFERENCES,
  onboarded: true,
};
beforeEach(() => {
  jest.useFakeTimers();
  jest
    .mocked(useAuth)
    .mockReturnValue({ session: { user: { id: 'returning' } } } as ReturnType<typeof useAuth>);
  jest.mocked(api.getMe).mockReset();
});
afterEach(() => jest.useRealTimers());
test.each(['error', 'timeout'])(
  '%s stays unknown; retry loads confirmed identity',
  async (failure) => {
    let resolve!: (value: Awaited<ReturnType<typeof api.getMe>>) => void;
    jest
      .mocked(api.getMe)
      .mockImplementationOnce(() =>
        failure === 'error' ? Promise.reject(new Error('Offline')) : new Promise(() => {}),
      );
    let tree!: { unmount(): void };
    await act(async () => {
      tree = create(
        <ProfileProvider>
          <Consumer />
        </ProfileProvider>,
      );
    });
    if (failure === 'timeout') {
      expect(profile.loading).toBe(true);
      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
    }
    expect(profile).toMatchObject({ loading: false, failed: true, username: null });
    jest.mocked(api.getMe).mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    await act(async () => profile.retry());
    expect(profile).toMatchObject({ loading: true, failed: false });
    await act(async () => resolve(me));
    expect(profile).toMatchObject({ loading: false, failed: false, username: 'returning' });
    await act(async () => tree.unmount());
  },
);
test('an old user lookup cannot expose identity after an account switch', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof api.getMe>>) => void;
  jest.mocked(api.getMe).mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const element = () => (
    <ProfileProvider>
      <Consumer />
    </ProfileProvider>
  );
  let tree!: { update(value: React.ReactElement): void; unmount(): void };
  await act(async () => {
    tree = create(element());
  });
  jest
    .mocked(useAuth)
    .mockReturnValue({ session: { user: { id: 'other' } } } as ReturnType<typeof useAuth>);
  jest.mocked(api.getMe).mockRejectedValueOnce(new Error('Offline'));
  await act(async () => tree.update(element()));
  await act(async () => resolve(me));
  expect(profile).toMatchObject({ failed: true, username: null, displayName: null });
  await act(async () => tree.unmount());
});
