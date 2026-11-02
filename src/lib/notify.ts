// Local notifications (work in Expo Go on iOS and Android; no push server needed).
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const supported = Platform.OS !== 'web';

/** Show banners even while the app is open, so the demo recording catches them. */
export function configureNotifications() {
  if (!supported) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  if (Platform.OS === 'android') {
    void Notifications.setNotificationChannelAsync('default', {
      name: 'WTW',
      importance: Notifications.AndroidImportance.MAX,
    }).catch(() => {});
  }
}

export async function ensureNotificationPermission(): Promise<boolean> {
  if (!supported) return false;
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    return (await Notifications.requestPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/** Fire a local notification after `seconds`; tapping it opens `url` (an in-app route). */
export async function notifyLater(title: string, body: string, url: string, seconds = 3) {
  if (!supported || !(await ensureNotificationPermission())) return;
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body, data: { url }, sound: true },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds },
    });
  } catch {
    // Demo nicety only.
  }
}

/** Whether the OS currently lets us notify (never prompts). */
export async function notificationsAllowed(): Promise<boolean> {
  if (!supported) return false;
  try {
    return (await Notifications.getPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/**
 * The in-app route a notification opens: our local ones carry a `url`; server pushes
 * (Alan's notify()) carry only a `pickId`, which opens that Pick wherever it is now.
 */
export function routeForNotification(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const { url, pickId } = data as { url?: unknown; pickId?: unknown };
  if (typeof url === 'string' && url.startsWith('/')) return url;
  if (typeof pickId === 'string' && pickId) return `/pick/${encodeURIComponent(pickId)}`;
  return null;
}

/** Calls `listener` when a notification arrives while the app is open. Returns an unsubscribe. */
export function onNotificationReceived(listener: () => void): () => void {
  if (!supported) return () => {};
  const sub = Notifications.addNotificationReceivedListener(() => listener());
  return () => sub.remove();
}

/**
 * Calls `open(route)` when the user taps one of our notifications, including the tap that
 * launched the app from closed. Returns an unsubscribe.
 */
export function onNotificationTap(open: (route: string) => void): () => void {
  if (!supported) return () => {};
  const handle = (response: Notifications.NotificationResponse | null) => {
    const route = routeForNotification(response?.notification.request.content.data);
    if (route) open(route);
  };
  try {
    handle(Notifications.getLastNotificationResponse());
    // Only once: a later remount must not reopen the same old notification.
    Notifications.clearLastNotificationResponse();
  } catch {
    // Not available on this platform/runtime.
  }
  const sub = Notifications.addNotificationResponseReceivedListener(handle);
  return () => sub.remove();
}
