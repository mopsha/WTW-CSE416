import React from 'react';
import { Platform } from 'react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import OnboardingScreen from '../../app/onboarding';
import { api } from '@/lib/api';
import { useProfile } from '@/hooks/useProfile';
import { registerForPush } from '@/lib/push';
import { openDeviceSettings } from '@/lib/settingsPermissions';

type Node = { props: Record<string, any> };
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

// The real permission helpers run against mocked OS modules, so these tests cover exactly
// when the system prompt (request*Async) is reached.
jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));
jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
}));
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  IosAuthorizationStatus: { PROVISIONAL: 3 },
}));
jest.mock('@/lib/push', () => ({ registerForPush: jest.fn() }));
jest.mock('@/lib/settingsPermissions', () => ({ openDeviceSettings: jest.fn() }));
jest.mock('@/hooks/useProfile', () => ({ useProfile: jest.fn() }));
jest.mock('@/lib/api', () => ({
  api: { getMyUserProfile: jest.fn(), updateProfileDetails: jest.fn() },
}));
jest.mock('@/components', () => {
  const React = jest.requireActual('react');
  return {
    ...jest.requireActual('@/components/theme'),
    onboardingStyles: { input: {}, fine: {} },
    OnboardingFrame: (props: { top: unknown; actions: unknown; children: unknown }) =>
      React.createElement('test-frame', props, props.top, props.children, props.actions),
    Button: (props: object) => React.createElement('test-button', props),
    PageDots: (props: object) => React.createElement('test-dots', props),
    Illustration: () => null,
    ErrorState: () => null,
  };
});

const res = (status: string, canAskAgain = status === 'undetermined') =>
  ({ status, granted: status === 'granted', canAskAgain, expires: 'never' }) as never;
let tree: Tree;
const finish = jest.fn();
const labels = () => tree.root.findAllByType('test-button').map((n) => n.props.label);
const frame = () => tree.root.findAllByType('test-frame')[0]!.props;
async function press(label: string) {
  const button = tree.root.findAllByType('test-button').find((n) => n.props.label === label);
  if (!button) throw new Error(`No "${label}" button; have ${labels().join(', ')}`);
  await act(async () => button.props.onPress());
}
async function render() {
  await act(async () => {
    tree = create(<OnboardingScreen />);
  });
}
function permissions(location: string, notifications: string) {
  jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue(res(location));
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(res(notifications));
}

const originalOS = Platform.OS;
afterAll(() => Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true }));
beforeEach(async () => {
  jest.clearAllMocks();
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
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
  jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue(res('denied'));
  jest.mocked(Notifications.requestPermissionsAsync).mockResolvedValue(res('denied'));
  permissions('undetermined', 'undetermined');
  await render();
});
afterEach(async () => {
  await act(async () => tree.unmount());
});

test('skipping setup never prompts and enters Picks even if saving the dismissal fails', async () => {
  finish.mockRejectedValue(new Error('offline'));
  await press('Skip setup');
  expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  expect(api.updateProfileDetails).not.toHaveBeenCalled();
  expect(router.replace).toHaveBeenCalledWith('/');
  expect(finish).toHaveBeenCalledTimes(1);
});

test('favorites keep existing fields and privacy; empty Continue saves nothing', async () => {
  await act(async () => {
    tree.root
      .findAllByProps({ accessibilityLabel: 'Favorite activity' })[0]!
      .props.onChangeText('Basketball');
  });
  await press('Continue');
  expect(api.updateProfileDetails).toHaveBeenCalledWith({
    username: 'josh',
    favoriteCuisine: 'Italian',
    favoriteActivity: 'Basketball',
    shareMetadata: false,
  });
  expect(frame().title).toBe('Find spots near you');

  await act(async () => tree.unmount());
  jest.clearAllMocks();
  await render();
  await press('Continue');
  expect(api.updateProfileDetails).not.toHaveBeenCalled();
  expect(frame().title).toBe('Find spots near you');
});

test('opening a permission step never prompts; only Continue does, once per permission', async () => {
  await press('Not now'); // favorites
  expect(frame().title).toBe('Find spots near you');
  expect(labels()).toEqual(['Skip setup', 'Continue', 'Not now']);
  expect(Location.getForegroundPermissionsAsync).toHaveBeenCalled();
  expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();

  await press('Continue');
  expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(frame().title).toBe('Know when it’s time');
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();

  jest.mocked(Notifications.requestPermissionsAsync).mockResolvedValue(res('granted'));
  await press('Continue');
  expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(registerForPush).toHaveBeenCalledTimes(1);
  expect(frame().title).toBe('You’re all set');
  expect(finish).toHaveBeenCalledTimes(1);
});

test('Not now skips each permission with one tap and no prompt', async () => {
  await press('Not now'); // favorites
  await press('Not now'); // location
  expect(frame().title).toBe('Know when it’s time');
  await press('Not now'); // notifications
  expect(frame().title).toBe('You’re all set');
  expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  expect(registerForPush).not.toHaveBeenCalled();
  expect(finish).toHaveBeenCalledTimes(1);
  await press('Start picking');
  expect(router.replace).toHaveBeenCalledWith('/');
  expect(finish).toHaveBeenCalledTimes(1);
});

test('denying both permissions still finishes onboarding and enters Picks', async () => {
  await press('Not now');
  await press('Continue'); // location → denied
  await press('Continue'); // notifications → denied
  expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(registerForPush).not.toHaveBeenCalled();
  expect(frame().title).toBe('You’re all set');
  expect(finish).toHaveBeenCalledTimes(1);
  await press('Start picking');
  expect(router.replace).toHaveBeenCalledWith('/');
});

test('an already denied permission is not re-prompted and offers Open Settings', async () => {
  permissions('denied', 'granted');
  await press('Not now');
  expect(frame().body).toContain('Location is off');
  expect(labels()).toEqual(['Skip setup', 'Continue', 'Open Settings']);
  await press('Open Settings');
  expect(openDeviceSettings).toHaveBeenCalledTimes(1);
  await press('Continue');
  expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  // Already granted notifications: Continue moves on and keeps the push token current.
  expect(frame().body).toContain('Notifications are on');
  expect(labels()).not.toContain('Open Settings');
  await press('Continue');
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  expect(registerForPush).toHaveBeenCalledTimes(1);
  expect(frame().title).toBe('You’re all set');
});

test('step dots and every button are labelled for screen readers', async () => {
  expect(tree.root.findAllByType('test-dots')[0]!.props).toMatchObject({
    index: 0,
    total: 4,
    noun: 'Step',
  });
  for (const b of tree.root.findAllByType('test-button'))
    expect(b.props.accessibilityLabel ?? b.props.label).toBeTruthy();
});
