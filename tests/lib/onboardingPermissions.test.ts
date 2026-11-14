import { Platform } from 'react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import {
  readLocationPermission,
  readNotificationPermission,
  requestLocationPermission,
  requestNotificationPermission,
} from '@/lib/permissions';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { hasSeenIntro, markIntroSeen } from '@/lib/intro';

jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
}));
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  IosAuthorizationStatus: { PROVISIONAL: 3 },
}));

const res = (status: string, canAskAgain = true) =>
  ({ status, granted: status === 'granted', canAskAgain, expires: 'never' }) as never;
const originalOS = Platform.OS;
beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
});
afterAll(() => Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true }));

test('reading never prompts', async () => {
  jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue(res('undetermined'));
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(res('undetermined'));
  expect(await readLocationPermission()).toEqual({ status: 'undetermined', canAskAgain: true });
  expect(await readNotificationPermission()).toEqual({ status: 'undetermined', canAskAgain: true });
  expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
});

test('an undecided permission shows the system prompt once', async () => {
  jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue(res('undetermined'));
  jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue(res('denied', false));
  expect(await requestLocationPermission()).toEqual({ status: 'denied', canAskAgain: false });
  expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
});

test.each(['granted', 'denied'])('an already %s permission is never re-prompted', async (s) => {
  // Android reports a first denial with canAskAgain: true; it is still a decision.
  jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue(res(s, true));
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(res(s, true));
  expect((await requestLocationPermission()).status).toBe(s);
  expect((await requestNotificationPermission()).status).toBe(s);
  expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
});

test('iOS provisional notifications count as granted', async () => {
  jest
    .mocked(Notifications.getPermissionsAsync)
    .mockResolvedValue({ ...(res('denied') as object), ios: { status: 3 } } as never);
  expect((await readNotificationPermission()).status).toBe('granted');
});

test('web and native failures are unavailable and never throw', async () => {
  jest.mocked(Location.getForegroundPermissionsAsync).mockRejectedValue(new Error('x'));
  expect((await requestLocationPermission()).status).toBe('unavailable');
  Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
  expect((await requestNotificationPermission()).status).toBe('unavailable');
  expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
});

test('intro seen flag persists and storage failures read as seen', async () => {
  await AsyncStorage.clear();
  expect(await hasSeenIntro()).toBe(false);
  await markIntroSeen();
  expect(await hasSeenIntro()).toBe(true);
  jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('disk'));
  expect(await hasSeenIntro()).toBe(true);
});
