import React from 'react';
import OnboardingScreen from '../../app/onboarding';
import { api } from '@/lib/api';
import { useProfile } from '@/hooks/useProfile';
import * as Location from 'expo-location';
import { ensureNotificationPermission } from '@/lib/notify';
import { router } from 'expo-router';

type Node = {
  props: {
    label?: string;
    accessibilityLabel?: string;
    onPress(): void;
    onChangeText(s: string): void;
  };
};
type Tree = {
  root: {
    findAllByType(type: string): Node[];
    findAllByProps(props: Record<string, unknown>): Node[];
  };
  unmount(): void;
};
const { create, act } = jest.requireActual<{
  create(element: React.ReactElement): Tree;
  act(work: () => void | Promise<void>): Promise<void>;
}>('react-test-renderer');
jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));
jest.mock('expo-location', () => ({ requestForegroundPermissionsAsync: jest.fn() }));
jest.mock('@/lib/notify', () => ({ ensureNotificationPermission: jest.fn() }));
jest.mock('@/lib/push', () => ({ registerForPush: jest.fn() }));
jest.mock('@/hooks/useProfile', () => ({ useProfile: jest.fn() }));
jest.mock('@/lib/api', () => ({
  api: { getMyUserProfile: jest.fn(), updateProfileDetails: jest.fn() },
}));
jest.mock('@/components', () => {
  const actual = jest.requireActual('@/components/theme');
  const React = jest.requireActual('react');
  return {
    ...actual,
    Screen: ({ children }: { children: React.ReactNode }) => children,
    Button: (props: object) => React.createElement('test-button', props),
    EmptyState: () => null,
    ErrorState: () => null,
  };
});
let tree: Tree;
const finish = jest.fn();
async function press(label: string) {
  await act(async () => {
    tree.root
      .findAllByType('test-button')
      .find((n) => n.props.label === label)!
      .props.onPress();
  });
}
beforeEach(async () => {
  jest.clearAllMocks();
  finish.mockResolvedValue(undefined);
  jest
    .mocked(useProfile)
    .mockReturnValue({ finishOptionalSetup: finish } as unknown as ReturnType<typeof useProfile>);
  jest.mocked(api.getMyUserProfile).mockResolvedValue({
    username: 'josh',
    shareMetadata: false,
    favoriteCuisine: 'Italian',
    favoriteActivity: null,
  } as Awaited<ReturnType<typeof api.getMyUserProfile>>);
  jest
    .mocked(api.updateProfileDetails)
    .mockResolvedValue({} as Awaited<ReturnType<typeof api.updateProfileDetails>>);
  jest.mocked(ensureNotificationPermission).mockResolvedValue(false);
  await act(async () => {
    tree = create(<OnboardingScreen />);
  });
});
afterEach(async () => {
  await act(async () => tree.unmount());
});
test('opening and skipping optional setup never requests permissions, even if dismissal fails', async () => {
  finish.mockRejectedValue(new Error('offline'));
  await press('Skip setup & enter WTW');
  expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  expect(ensureNotificationPermission).not.toHaveBeenCalled();
  expect(api.updateProfileDetails).not.toHaveBeenCalled();
  expect(router.replace).toHaveBeenCalledWith('/');
});
test('favorites reuse existing fields and privacy; each permission requires a separate tap and denial continues', async () => {
  await act(async () => {
    tree.root
      .findAllByProps({ accessibilityLabel: 'Favorite activity' })[0]!
      .props.onChangeText('Basketball');
  });
  await press('Save & continue');
  expect(api.updateProfileDetails).toHaveBeenCalledWith({
    username: 'josh',
    favoriteCuisine: 'Italian',
    favoriteActivity: 'Basketball',
    shareMetadata: false,
  });
  expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  await press('Allow location');
  expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(ensureNotificationPermission).not.toHaveBeenCalled();
  await press('Turn on notifications');
  expect(ensureNotificationPermission).toHaveBeenCalledTimes(1);
  expect(finish).toHaveBeenCalledTimes(1);
  expect(router.replace).toHaveBeenCalledWith('/');
});
