// Onboarding permission helpers (App Store guideline 5.1.1): reading never prompts, and a
// request only shows the system prompt while the permission is still undecided. Once the
// person has answered (granted or denied), we never ask again; Settings is the way back.
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

export type PermissionStatus = 'undetermined' | 'granted' | 'denied' | 'unavailable';

export interface PermissionInfo {
  status: PermissionStatus;
  /** False when the OS will no longer show its prompt (only Settings can change it). */
  canAskAgain: boolean;
}

const UNAVAILABLE: PermissionInfo = { status: 'unavailable', canAskAgain: false };
const supported = () => Platform.OS === 'ios' || Platform.OS === 'android';

function classify(r: {
  status: string;
  granted: boolean;
  canAskAgain: boolean;
  ios?: { status?: number } | null;
}): PermissionInfo {
  // iOS provisional (quiet) notifications count as allowed; the docs say to check ios.status.
  const provisional = r.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  if (r.granted || provisional) return { status: 'granted', canAskAgain: r.canAskAgain };
  if (r.status === 'undetermined') return { status: 'undetermined', canAskAgain: r.canAskAgain };
  return { status: 'denied', canAskAgain: r.canAskAgain };
}

/** Whether a "Continue" tap would show the system prompt. */
export function wouldPrompt(info: PermissionInfo): boolean {
  return info.status === 'undetermined' && info.canAskAgain;
}

/** Read-only: never shows a prompt. */
export async function readLocationPermission(): Promise<PermissionInfo> {
  if (!supported()) return UNAVAILABLE;
  try {
    return classify(await Location.getForegroundPermissionsAsync());
  } catch {
    return UNAVAILABLE;
  }
}

/** Shows the system prompt only if location is still undecided. Never throws. */
export async function requestLocationPermission(): Promise<PermissionInfo> {
  const current = await readLocationPermission();
  if (!wouldPrompt(current)) return current;
  try {
    return classify(await Location.requestForegroundPermissionsAsync());
  } catch {
    return current;
  }
}

/** Read-only: never shows a prompt. */
export async function readNotificationPermission(): Promise<PermissionInfo> {
  if (!supported()) return UNAVAILABLE;
  try {
    return classify(await Notifications.getPermissionsAsync());
  } catch {
    return UNAVAILABLE;
  }
}

/**
 * Shows the system prompt only if notifications are still undecided. Never throws.
 * Android 13 needs a notification channel first; configureNotifications() creates it at start.
 */
export async function requestNotificationPermission(): Promise<PermissionInfo> {
  const current = await readNotificationPermission();
  if (!wouldPrompt(current)) return current;
  try {
    return classify(await Notifications.requestPermissionsAsync());
  } catch {
    return current;
  }
}
