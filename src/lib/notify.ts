// Device notification presentation and tap routing.
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { readNotificationPermission } from './permissions';

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

/**
 * Whether the OS currently lets us notify (never prompts). Same check as onboarding, so
 * iOS provisional (quiet) permission counts as allowed. Never throws.
 */
export async function notificationsAllowed(): Promise<boolean> {
  return (await readNotificationPermission()).status === 'granted';
}

/**
 * Pick pushes open the live Pick entry; older device notifications can carry a URL.
 */
export function routeForNotification(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  if ((data as { type?: unknown }).type === 'direct_message') {
    const id = (data as { conversationId?: unknown }).conversationId;
    return typeof id === 'string' && id ? `/messages/${encodeURIComponent(id)}` : null;
  }
  if ((data as { type?: unknown }).type === 'group_message') {
    const groupId = (data as { groupId?: unknown }).groupId;
    return typeof groupId === 'string' && groupId
      ? `/groups/${encodeURIComponent(groupId)}?section=chat`
      : null;
  }
  if ((data as { type?: unknown }).type === 'hang_invite') {
    const { hangId } = data as { hangId?: unknown };
    return typeof hangId === 'string' && hangId.trim()
      ? `/hang/${encodeURIComponent(hangId)}`
      : '/';
  }
  if ((data as { type?: unknown }).type === 'group_invite') return '/friends?requests=1';
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

export function notificationTap(data: unknown): { route: string; notificationId?: string } | null {
  const route = routeForNotification(data);
  if (!route) return null;
  const { notificationId } = data as { notificationId?: unknown };
  return typeof notificationId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(notificationId)
    ? { route, notificationId }
    : { route };
}

/** Open both warm and cold-start taps and consume the stored launch response. */
export function onNotificationTap(
  open: (route: string, notificationId?: string) => void,
): () => void {
  if (!supported) return () => {};
  const handle = (response: Notifications.NotificationResponse | null) => {
    const tap = notificationTap(response?.notification.request.content.data);
    if (tap) open(tap.route, tap.notificationId);
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
