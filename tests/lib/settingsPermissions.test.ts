import { Platform, Linking } from 'react-native';
import * as Location from 'expo-location';
import { notificationsAllowed } from '@/lib/notify';
import { readSettingsPermissions, openDeviceSettings } from '@/lib/settingsPermissions';
jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));
jest.mock('@/lib/notify', () => ({
  notificationsAllowed: jest.fn(),
  ensureNotificationPermission: jest.fn(),
}));
const originalOS = Platform.OS;
beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
  jest.mocked(notificationsAllowed).mockResolvedValue(true);
  jest
    .mocked(Location.getForegroundPermissionsAsync)
    .mockResolvedValue({ status: 'granted' } as Location.LocationPermissionResponse);
});
afterAll(() => Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true }));
test('opening settings reads status without any location request or fix', async () => {
  expect(await readSettingsPermissions()).toEqual({ notifications: true, location: 'granted' });
  expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
});
test('web does not query unsupported native permission modules', async () => {
  Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
  expect(await readSettingsPermissions()).toEqual({ notifications: null, location: 'unavailable' });
  expect(Location.getForegroundPermissionsAsync).not.toHaveBeenCalled();
  expect(notificationsAllowed).not.toHaveBeenCalled();
  await expect(openDeviceSettings()).rejects.toThrow('browser');
});
test('permission read failures remain informational', async () => {
  jest.mocked(Location.getForegroundPermissionsAsync).mockRejectedValue(new Error('unsupported'));
  expect(await readSettingsPermissions()).toEqual({ notifications: true, location: 'unavailable' });
});
test('system-settings errors are caught and useful', async () => {
  const open = jest.spyOn(Linking, 'openSettings').mockRejectedValue(new Error('native error'));
  await expect(openDeviceSettings()).rejects.toThrow('Could not open device settings');
  open.mockRestore();
});
