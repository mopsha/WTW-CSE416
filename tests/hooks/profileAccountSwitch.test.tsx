import React from 'react';
import { ProfileProvider, useProfile } from '@/hooks/useProfile';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { EMPTY_PREFERENCES } from '@shared/domain/preferences.ts';
const { create, act } = jest.requireActual<{
  create(e: React.ReactElement): { update(e: React.ReactElement): void; unmount(): void };
  act(work: () => void | Promise<void>): Promise<void>;
}>('react-test-renderer');
jest.mock('@/hooks/useAuth', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/api', () => ({
  api: { getMe: jest.fn(), updateMe: jest.fn(), savePreferences: jest.fn() },
}));
let profile!: ReturnType<typeof useProfile>;
function Consumer() {
  const value = useProfile();
  React.useEffect(() => {
    profile = value;
  }, [value]);
  return null;
}
const treeValue = () => (
  <ProfileProvider>
    <Consumer />
  </ProfileProvider>
);
test('delayed name/preferences saves from account A do not alter account B context', async () => {
  jest
    .mocked(useAuth)
    .mockReturnValue({
      session: { user: { id: 'a', email: 'a@example.com' }, accessToken: 'a' },
      loading: false,
    });
  jest
    .mocked(api.getMe)
    .mockResolvedValue({
      displayName: 'A',
      username: 'user_a',
      optionalSetupPending: false,
      preferences: EMPTY_PREFERENCES,
      onboarded: false,
    });
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(treeValue());
  });
  let resolveName!: (value: { displayName: string }) => void;
  let resolvePrefs!: (value: Awaited<ReturnType<typeof api.savePreferences>>) => void;
  jest.mocked(api.updateMe).mockReturnValue(
    new Promise((r) => {
      resolveName = r;
    }),
  );
  jest.mocked(api.savePreferences).mockReturnValue(
    new Promise((r) => {
      resolvePrefs = r;
    }),
  );
  const nameSave = profile.saveDisplayName('A edited');
  const prefSave = profile.savePreferences({ ...EMPTY_PREFERENCES, priceMax: 2 });
  jest
    .mocked(useAuth)
    .mockReturnValue({
      session: { user: { id: 'b', email: 'b@example.com' }, accessToken: 'b' },
      loading: false,
    });
  jest
    .mocked(api.getMe)
    .mockResolvedValue({
      displayName: 'B',
      username: 'user_b',
      optionalSetupPending: false,
      preferences: EMPTY_PREFERENCES,
      onboarded: false,
    });
  await act(async () => tree.update(treeValue()));
  await act(async () => {
    resolveName({ displayName: 'A edited' });
    resolvePrefs({ preferences: { ...EMPTY_PREFERENCES, priceMax: 2 }, onboarded: true });
    await nameSave;
    await prefSave;
  });
  expect(profile.displayName).toBe('B');
  expect(profile.preferences).toEqual(EMPTY_PREFERENCES);
  expect(profile.onboarded).toBe(false);
  await act(async () => tree.unmount());
});
