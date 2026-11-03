import * as Location from 'expo-location';
import { Linking, Platform } from 'react-native';
import { notificationsAllowed } from './notify';
export interface SettingsPermissions {
  notifications: boolean | null;
  location: 'granted' | 'denied' | 'undetermined' | 'unavailable';
}
/** Read-only: never requests a permission, location fix, or push token. */
export async function readSettingsPermissions(): Promise<SettingsPermissions> {
  if (Platform.OS === 'web') return { notifications: null, location: 'unavailable' };
  const [notifications, location] = await Promise.all([
    notificationsAllowed().catch(() => false),
    Location.getForegroundPermissionsAsync()
      .then((p) => p.status)
      .catch(() => 'unavailable' as const),
  ]);
  return { notifications, location };
}
export async function openDeviceSettings(): Promise<void> {
  if (Platform.OS === 'web') throw new Error('Manage permissions in your browser’s site settings.');
  try {
    await Linking.openSettings();
  } catch {
    throw new Error(
      'Could not open device settings. Open WTW permissions in your phone’s Settings.',
    );
  }
}
