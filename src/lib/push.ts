// Remote push: send this device's Expo push token to the API (Alan's POST /push-tokens) so
// Pick events reach it. Needs a development or store build: Expo Go on Android has no remote
// push, and the token needs the EAS project id (app.json extra.eas.projectId, from `eas init`).
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { api } from './api';
import { notificationsAllowed } from './notify';

/**
 * Registers the push token if notifications are already allowed. Never prompts and never
 * throws: a missing project id, Expo Go, no network, or an API without the route yet all
 * just mean no push on this device for now; the next app start tries again.
 */
export async function registerForPush(): Promise<boolean> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return false;
  if (!(await notificationsAllowed())) return false;
  const projectId =
    (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId ??
    Constants.easConfig?.projectId;
  if (!projectId) return false;
  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await api.registerPushToken(token, Platform.OS);
    return true;
  } catch {
    return false;
  }
}
