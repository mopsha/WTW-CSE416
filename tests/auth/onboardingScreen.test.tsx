import React from 'react';
import { Platform } from 'react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import OnboardingScreen from '../../app/onboarding';
import { currentLocation } from '@/lib/locationSearch';
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
let mockParams: { mode?: string } = {};
jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => false) },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/lib/locationSearch', () => ({ currentLocation: jest.fn() }));
jest.mock('@/components/TasteSwipe', () => {
  const React = jest.requireActual('react');
  return { TasteSwipe: (props: object) => React.createElement('test-taste', props) };
});
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
jest.mock('@/components', () => {
  const React = jest.requireActual('react');
  return {
    ...jest.requireActual('@/components/theme'),
    onboardingStyles: { input: {}, fine: {} },
    OnboardingFrame: (props: { top: unknown; actions: unknown; children: unknown }) =>
      React.createElement('test-frame', props, props.top, props.children, props.actions),
    Button: (props: object) => React.createElement('test-button', props),
    PageDots: (props: object) => React.createElement('test-dots', props),
    Screen: (props: { children: unknown }) =>
      React.createElement('test-screen', props, props.children),
    PreferencesForm: (props: object) => React.createElement('test-prefs', props),
    OnboardingCopy: (props: object) => React.createElement('test-copy', props),
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
const save = jest.fn();
const screenTitle = () => tree.root.findAllByType('test-copy')[0]?.props.title;
/** Past the practice swipe and the form without saving anything. */
async function skipTaste() {
  expect(screenTitle()).toBe('What sounds good?');
  await press('Skip swiping');
  expect(screenTitle()).toBe('Here’s your taste');
  await press('Not now');
}
afterAll(() => Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true }));
beforeEach(async () => {
  jest.clearAllMocks();
  mockParams = {};
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
  finish.mockResolvedValue(undefined);
  save.mockResolvedValue(undefined);
  jest.mocked(useProfile).mockReturnValue({
    finishOptionalSetup: finish,
    savePreferences: save,
    preferences: {
      categories: [],
      types: [],
      dislikedTypes: [],
      priceMax: 2,
      maxDistanceM: null,
    },
  } as unknown as ReturnType<typeof useProfile>);
  jest.mocked(currentLocation).mockResolvedValue({ lat: 40.9, lng: -73.1 });
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
  expect(save).not.toHaveBeenCalled();
  expect(router.replace).toHaveBeenCalledWith('/');
  expect(finish).toHaveBeenCalledTimes(1);
});

test('practice swipes use my location, prefill the form, and Save stores them', async () => {
  jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue(res('granted'));
  await press('Continue'); // location → granted
  const taste = tree.root.findAllByType('test-taste')[0]!;
  expect(taste.props.center).toEqual({ lat: 40.9, lng: -73.1 });
  await act(async () =>
    taste.props.onDone([
      { card: { type: 'sushi_restaurant', category: 'food' }, value: 2 },
      { card: { type: 'bowling_alley', category: 'activities' }, value: 0 },
    ]),
  );
  const expected = {
    categories: ['food'],
    types: ['sushi_restaurant'],
    dislikedTypes: ['bowling_alley'],
    priceMax: 2,
    maxDistanceM: null,
  };
  expect(tree.root.findAllByType('test-prefs')[0]!.props.value).toEqual(expected);
  await press('Save');
  expect(save).toHaveBeenCalledWith(expected);
  expect(frame().title).toBe('Know when it’s time');
});

test('without location the practice swipe gets no center and nothing reads the GPS', async () => {
  await press('Not now'); // location
  expect(tree.root.findAllByType('test-taste')[0]!.props.center).toBeNull();
  expect(currentLocation).not.toHaveBeenCalled();
});

test('opening a permission step never prompts; only Continue does, once per permission', async () => {
  expect(frame().title).toBe('Find spots near you');
  expect(labels()).toEqual(['Skip setup', 'Continue', 'Not now']);
  expect(Location.getForegroundPermissionsAsync).toHaveBeenCalled();
  expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();

  await press('Continue');
  expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
  await skipTaste();
  expect(frame().title).toBe('Know when it’s time');
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();

  jest.mocked(Notifications.requestPermissionsAsync).mockResolvedValue(res('granted'));
  await press('Continue');
  expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(registerForPush).toHaveBeenCalledTimes(1);
  expect(frame().title).toBe('You’re all set');
  expect(finish).toHaveBeenCalledTimes(1);
});

test('Not now skips each step with one tap and no prompt', async () => {
  await press('Not now'); // location
  await skipTaste();
  expect(frame().title).toBe('Know when it’s time');
  await press('Not now'); // notifications
  expect(frame().title).toBe('You’re all set');
  expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  expect(registerForPush).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
  expect(finish).toHaveBeenCalledTimes(1);
  await press('Start picking');
  expect(router.replace).toHaveBeenCalledWith('/');
  expect(finish).toHaveBeenCalledTimes(1);
});

test('denying both permissions still finishes onboarding and enters Picks', async () => {
  await press('Continue'); // location → denied
  await skipTaste();
  await press('Continue'); // notifications → denied
  expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(currentLocation).not.toHaveBeenCalled();
  expect(registerForPush).not.toHaveBeenCalled();
  expect(frame().title).toBe('You’re all set');
  expect(finish).toHaveBeenCalledTimes(1);
  await press('Start picking');
  expect(router.replace).toHaveBeenCalledWith('/');
});

test('an already denied permission is not re-prompted and offers Open Settings', async () => {
  await act(async () => tree.unmount());
  permissions('denied', 'granted');
  await render();
  expect(frame().body).toContain('Location is off');
  expect(labels()).toEqual(['Skip setup', 'Continue', 'Open Settings']);
  await press('Open Settings');
  expect(openDeviceSettings).toHaveBeenCalledTimes(1);
  await press('Continue');
  expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  await skipTaste();
  // Already granted notifications: Continue moves on and keeps the push token current.
  expect(frame().body).toContain('Notifications are on');
  expect(labels()).not.toContain('Open Settings');
  await press('Continue');
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  expect(registerForPush).toHaveBeenCalledTimes(1);
  expect(frame().title).toBe('You’re all set');
});

test('the Home nudge opens only the taste steps and never finishes setup', async () => {
  await act(async () => tree.unmount());
  mockParams = { mode: 'taste' };
  permissions('granted', 'undetermined');
  await render();
  expect(screenTitle()).toBe('What sounds good?');
  expect(tree.root.findAllByType('test-taste')[0]!.props.center).toEqual({
    lat: 40.9,
    lng: -73.1,
  });
  expect(labels()).toContain('Close');
  await press('Skip swiping');
  await press('Save');
  expect(save).toHaveBeenCalledTimes(1);
  expect(router.replace).toHaveBeenCalledWith('/');
  expect(finish).not.toHaveBeenCalled();
  expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
});

test('taste-only mode returns to the screen that opened it', async () => {
  await act(async () => tree.unmount());
  mockParams = { mode: 'taste' };
  jest.mocked(router.canGoBack).mockReturnValue(true);
  await render();
  await press('Close');
  expect(router.back).toHaveBeenCalledTimes(1);
  expect(router.replace).not.toHaveBeenCalled();
  jest.mocked(router.canGoBack).mockReturnValue(false);
});

test('step dots and every button are labelled for screen readers', async () => {
  expect(tree.root.findAllByType('test-dots')[0]!.props).toMatchObject({
    index: 0,
    total: 5,
    noun: 'Step',
  });
  for (const b of tree.root.findAllByType('test-button'))
    expect(b.props.accessibilityLabel ?? b.props.label).toBeTruthy();
});
