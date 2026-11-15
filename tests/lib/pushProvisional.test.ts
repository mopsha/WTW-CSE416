// Regression (PR #62 review): iOS provisional notification permission must count as allowed
// for push registration too. registerForPush, notificationsAllowed and the permissions helper
// all run for real; only the native module, app config and API are mocked.
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import { api } from '@/lib/api';
import { registerForPush } from '@/lib/push';

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  IosAuthorizationStatus: { PROVISIONAL: 3 },
}));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { eas: { projectId: 'proj-1' } } } },
}));
jest.mock('@/lib/api', () => ({ api: { registerPushToken: jest.fn() } }));

const originalOS = Platform.OS;
beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
  jest
    .mocked(Notifications.getExpoPushTokenAsync)
    .mockResolvedValue({ type: 'expo', data: 'ExponentPushToken[abc]' });
  jest.mocked(api.registerPushToken).mockResolvedValue(undefined as never);
});
afterAll(() => Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true }));

const perm = (granted: boolean, iosStatus?: number) =>
  ({
    status: granted ? 'granted' : 'undetermined',
    granted,
    canAskAgain: true,
    expires: 'never',
    ios: iosStatus === undefined ? undefined : { status: iosStatus },
  }) as never;

test('provisional iOS permission registers a push token', async () => {
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(perm(false, 3));
  expect(await registerForPush()).toBe(true);
  expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'proj-1' });
  expect(api.registerPushToken).toHaveBeenCalledWith('ExponentPushToken[abc]', 'ios');
});

test('undecided permission does not request a token', async () => {
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(perm(false, 0));
  expect(await registerForPush()).toBe(false);
  expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
});
