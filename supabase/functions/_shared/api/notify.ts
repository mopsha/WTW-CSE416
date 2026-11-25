// Notifications and Expo push (Alan, M4). notify() writes the in-app inbox row first and
// pushes only to people who got a NEW row, so a repeated event (retried close, racing vote
// settles, the every-minute sweep) never pushes twice: the unique index in
// 0009_notifications.sql decides. Contract: docs/api-integration.md.

import { ApiError } from './errors.ts';
import type { AvatarRef } from './avatars.ts';

export const NOTIFICATION_TYPES = [
  'friend_request',
  'friend_accepted',
  'hang_rsvp',
  'direct_message',
  'group_message',
  'group_invite',
  'hang_invite',
  'added_to_pick',
  'pick_started',
  'reminder',
  'vote_needed',
  'winner_decided',
  'pick_canceled',
  'plan_time_set',
  'time_suggested',
  'plan_reminder',
  'did_you_go',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * Lock screens are public, so push text is generic: no place names, no answers, no cancel
 * reasons. Details are in the in-app inbox, which only the owner can read.
 */
export const PUSH_TEXT: Readonly<Record<NotificationType, { title: string; body: string }>> = {
  friend_request: { title: 'Friend request', body: 'Someone sent you a friend request.' },
  friend_accepted: { title: 'Friend request accepted', body: 'You have a new friend on WTW.' },
  hang_rsvp: { title: 'Hang responses', body: 'People responded to your Hang.' },
  direct_message: {
    title: 'New message',
    body: 'A friend sent you a message. Open WTW to read it.',
  },
  group_message: {
    title: 'New group message',
    body: 'There’s a new message in your group. Open WTW to read it.',
  },
  group_invite: {
    title: 'Group invitation',
    body: 'Someone invited you to a group. Open WTW to respond.',
  },
  hang_invite: { title: 'New Hang', body: 'Someone invited you to a Hang. Open WTW to respond.' },
  added_to_pick: { title: 'You’re in a Pick', body: 'Someone added you to a Pick.' },
  pick_started: { title: 'Time to swipe', body: 'Your Pick has started.' },
  reminder: { title: 'Swipe deadline approaching', body: 'You haven’t finished swiping yet.' },
  vote_needed: { title: 'Time to vote', body: 'Your Pick is down to a final vote.' },
  winner_decided: { title: 'It’s decided', body: 'Your Pick has a winner.' },
  pick_canceled: { title: 'Pick canceled', body: 'The host canceled a Pick.' },
  time_suggested: {
    title: 'New time suggestion',
    body: 'Someone suggested a different time. Open WTW to review it.',
  },
  plan_time_set: { title: 'Plan time set', body: 'Your plan has a time. Are you going?' },
  plan_reminder: { title: 'Starting soon', body: 'Your plan is starting soon.' },
  did_you_go: { title: 'Did you go?', body: 'Tap to tell your group.' },
};

/** Push and inbox use the same generic, privacy-safe schedule-change wording. */
export function notificationText(type: NotificationType, payload: Record<string, unknown> = {}) {
  if (type === 'plan_time_set' && payload.reconfirmRsvp === true)
    return { title: 'Plan time changed', body: 'The schedule changed. Open WTW to RSVP again.' };
  return PUSH_TEXT[type] ?? { title: 'WTW', body: 'Something happened.' };
}

export interface ActivityDetails {
  actorId?: string;
  actorName?: string;
  avatarRef?: AvatarRef;
  groupName?: string;
  hangName?: string;
  winnerName?: string;
  replyCount?: number;
  otherReplyCount?: number;
  replyStatus?: 'down' | 'maybe' | 'cant';
}

export interface NotificationRow {
  id: string;
  type: NotificationType;
  pickId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  activityAt?: string;
  readAt: string | null;
  activity?: ActivityDetails;
}

export interface NotificationCursor {
  createdAt: string;
  id: string;
  orderVersion?: string;
}

export interface ActivitySnapshot {
  page: NotificationRow[];
  notifications: NotificationRow[];
  orderVersion: string;
  reset: boolean;
}

export interface ActivityPage {
  notifications: NotificationRow[];
  unreadCount: number;
  nextCursor: string | null;
  orderVersion?: string;
  reset?: boolean;
}

/** Database adapter (service role). */
export interface NotifyStore {
  /** Returns only newly inserted notification IDs. */
  insert(
    userIds: string[],
    type: NotificationType,
    pickId: string | null,
    payload: Record<string, unknown>,
  ): Promise<string[]>;
  pushTargets(
    notificationIds: string[],
    hang?: { id: string; userIds: string[] },
  ): Promise<{ token: string; notification_id: string; deadline: string | null }[]>;
  deleteTokens(tokens: string[]): Promise<void>;
  snapshot(
    userId: string,
    ids: string[],
    limit?: number,
    before?: NotificationCursor,
  ): Promise<ActivitySnapshot>;
  /** Rejects (404) a notification that isn't the caller's. */
  markRead(id: string, userId: string): Promise<void>;
  registerToken(userId: string, token: string, platform: 'ios' | 'android'): Promise<void>;
  /** Deletes the token only if it is the caller's; otherwise does nothing. */
  removeToken(userId: string, token: string): Promise<void>;
}

export type PushFetch = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Sends an event to people. Never throws: the action that caused it (a close, a cancel)
 * has already happened and must not fail because the inbox or push did.
 */
export type Notifier = (
  userIds: readonly string[],
  type: NotificationType,
  pickId: string | null,
  payload?: Record<string, unknown>,
  options?: { inboxRecorded: true; notificationId?: string },
) => Promise<void>;

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
/** Expo's limit per request. */
export const PUSH_BATCH = 100;
export const PUSH_TIMEOUT_MS = 5_000;

// ponytail: tickets only. Expo's second step (push receipts, ~15 min later) also reports
// dead tokens; add a receipts check in the sweep if stale tokens pile up.
/** Sends one message to every token; returns tokens Expo says are no longer registered. */
export async function sendPush(
  fetchFn: PushFetch,
  messages: readonly {
    to: string;
    title: string;
    body: string;
    data: Record<string, unknown>;
    expiration?: number;
  }[],
  log: (...args: unknown[]) => void = console.error,
): Promise<string[]> {
  const dead: string[] = [];
  for (let i = 0; i < messages.length; i += PUSH_BATCH) {
    const batch = messages.slice(i, i + PUSH_BATCH);
    try {
      const res = await fetchFn(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(batch.map((message) => ({ sound: 'default', ...message }))),
        // A slow Expo must not hold up the close/cancel/vote that triggered this push.
        signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
      });
      // Logs carry status and error codes only, never tokens.
      if (!res.ok) {
        log('push batch failed', res.status);
        continue;
      }
      const tickets = ((await res.json()) as { data?: unknown }).data;
      if (!Array.isArray(tickets)) continue;
      const errors = new Set<string>();
      tickets.forEach((t: { status?: string; details?: { error?: string } } | null, j) => {
        const token = batch[j]?.to;
        if (t?.status !== 'error') return;
        const code = t.details?.error ?? 'unknown';
        if (token && code === 'DeviceNotRegistered') dead.push(token);
        else errors.add(code);
      });
      if (errors.size) log('push tickets failed', [...errors].join(','));
    } catch (error) {
      // One failed batch must not stop the rest.
      log('push batch failed', error instanceof Error ? error.name : 'unknown');
    }
  }
  return dead;
}

export function createNotifier(
  store: NotifyStore,
  fetchFn: PushFetch,
  log: (...args: unknown[]) => void = console.error,
): Notifier {
  return async (userIds, type, pickId, payload = {}, options) => {
    if (!userIds.length || type === 'friend_accepted' || type === 'hang_rsvp') return;
    try {
      const recipients = [...new Set(userIds)];
      // Hang creation returns only recipients whose inbox rows were just inserted.
      const hang =
        options?.inboxRecorded && type === 'hang_invite' && typeof payload.hangId === 'string'
          ? { id: payload.hangId, userIds: recipients }
          : undefined;
      const recordedRequest = type === 'friend_request' ? options?.notificationId : undefined;
      if (options?.inboxRecorded && !hang && !recordedRequest) return;
      const fresh = recordedRequest
        ? [recordedRequest]
        : hang
          ? []
          : await store.insert(recipients, type, pickId, payload);
      if (!hang && !fresh.length) return;
      const targets = await store.pushTargets(fresh, hang);
      const now = Date.now();
      const messages = targets
        .filter(({ deadline }) => deadline === null || Date.parse(deadline) > now)
        .map(({ token, notification_id, deadline }) => ({
          to: token,
          ...notificationText(type, payload),
          ...(deadline ? { expiration: Math.floor(Date.parse(deadline) / 1000) } : {}),
          data: {
            type,
            pickId,
            notificationId: notification_id,
            ...(type === 'hang_invite' ? { hangId: payload.hangId } : {}),
            ...(type === 'group_message' ? { groupId: payload.groupId } : {}),
            ...(type === 'direct_message' ? { conversationId: payload.conversationId } : {}),
          },
        }));
      const dead = await sendPush(fetchFn, messages, log);
      if (dead.length) await store.deleteTokens(dead);
    } catch (error) {
      log('notify failed', type, error instanceof Error ? error.name : 'unknown');
    }
  };
}

const TOKEN_RE = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{1,200}\]$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parsePushToken(body: unknown): { token: string; platform: 'ios' | 'android' } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ApiError(400, 'INVALID_INPUT', 'Expected a push token object');
  }
  const { token, platform } = body as Record<string, unknown>;
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) {
    throw new ApiError(400, 'INVALID_INPUT', 'Expected an Expo push token');
  }
  if (platform !== 'ios' && platform !== 'android') {
    throw new ApiError(400, 'INVALID_INPUT', 'platform must be ios or android');
  }
  return { token, platform };
}

/** POST /push-tokens: this device's token now belongs to the caller. */
export async function registerPushToken(store: NotifyStore, userId: string, body: unknown) {
  const { token, platform } = parsePushToken(body);
  await store.registerToken(userId, token, platform);
  return { status: 'ok' as const };
}

/** POST /push-tokens/remove { token }: on sign-out, this phone stops getting my pushes. */
export async function unregisterPushToken(store: NotifyStore, userId: string, body: unknown) {
  const token = (body as { token?: unknown } | null)?.token;
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) {
    throw new ApiError(400, 'INVALID_INPUT', 'Expected an Expo push token');
  }
  await store.removeToken(userId, token);
  return { status: 'ok' as const };
}

export const INBOX_LIMIT = 50;

/** Keep database timestamp precision; Date.toISOString would truncate microseconds. */
export function parseNotificationCursor(value?: string): NotificationCursor | undefined {
  if (value === undefined) return undefined;
  const [createdAt, id, orderVersion, extra] = value.split('|');
  if (
    extra !== undefined ||
    (orderVersion !== undefined &&
      (!/^(0|[1-9]\d{0,18})$/.test(orderVersion) || BigInt(orderVersion) > 9223372036854775807n)) ||
    !createdAt ||
    !id ||
    !UUID_RE.test(id) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(createdAt) ||
    !Number.isFinite(Date.parse(createdAt))
  )
    throw new ApiError(400, 'INVALID_INPUT', 'Invalid notification cursor');
  return { createdAt, id, ...(orderVersion === undefined ? {} : { orderVersion }) };
}

/** GET /notifications: same newest-first inbox, with an optional older-page cursor.
 * unreadCount keeps its existing meaning: unread rows on the returned page.
 */
export async function listNotifications(store: NotifyStore, userId: string, before?: string) {
  return formatPage(
    await store.snapshot(userId, [], INBOX_LIMIT + 1, parseNotificationCursor(before)),
  );
}

function formatPage(snapshot: ActivitySnapshot): ActivityPage {
  const notifications = snapshot.page.slice(0, INBOX_LIMIT);
  const last = notifications[notifications.length - 1];
  const version = snapshot.orderVersion === '0' ? undefined : snapshot.orderVersion;
  return {
    notifications,
    unreadCount: notifications.filter((n) => !n.readAt).length,
    nextCursor:
      snapshot.page.length > INBOX_LIMIT && last
        ? [last.activityAt ?? last.createdAt, last.id, ...(version ? [version] : [])].join('|')
        : null,
    ...(version ? { orderVersion: version } : {}),
    ...(snapshot.reset ? { reset: true } : {}),
  };
}

// 1,500 UUIDs fit within the Edge API's 64 KiB JSON body limit.
export const INBOX_REVALIDATE_LIMIT = 1500;

export async function revalidateNotifications(store: NotifyStore, userId: string, body: unknown) {
  const input = body as { ids?: unknown; before?: unknown; includePage?: unknown } | null;
  if (
    !Array.isArray(input?.ids) ||
    input.ids.length > INBOX_REVALIDATE_LIMIT ||
    input.ids.some((id) => typeof id !== 'string' || !UUID_RE.test(id)) ||
    (input.before !== undefined && typeof input.before !== 'string') ||
    (input.includePage !== undefined && typeof input.includePage !== 'boolean')
  )
    throw new ApiError(400, 'INVALID_INPUT', 'Invalid notification page');
  const ids = [...new Set<string>(input.ids)];
  const before = parseNotificationCursor(input.before);
  const includePage = input.includePage || before !== undefined;
  const snapshot = await store.snapshot(
    userId,
    ids,
    includePage ? INBOX_LIMIT + 1 : undefined,
    before,
  );
  return {
    notifications: snapshot.notifications,
    page: includePage ? formatPage(snapshot) : undefined,
  };
}

/** POST /notifications/:id/read. Someone else's id is a 404, same as an unknown one. */
export async function markNotificationRead(store: NotifyStore, id: string, userId: string) {
  if (!UUID_RE.test(id)) {
    throw new ApiError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found');
  }
  await store.markRead(id, userId);
  return { status: 'ok' as const };
}
