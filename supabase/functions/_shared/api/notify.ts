// Notifications and Expo push (Alan, M4). notify() writes the in-app inbox row first and
// pushes only to people who got a NEW row, so a repeated event (retried close, racing vote
// settles, the every-minute sweep) never pushes twice: the unique index in
// 0009_notifications.sql decides. Contract: docs/api-integration.md.

import { ApiError } from './errors.ts';

export const NOTIFICATION_TYPES = [
  'added_to_pick',
  'pick_started',
  'reminder',
  'vote_needed',
  'winner_decided',
  'pick_canceled',
  'plan_time_set',
  'plan_reminder',
  'did_you_go',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * Lock screens are public, so push text is generic: no place names, no answers, no cancel
 * reasons. Details are in the in-app inbox, which only the owner can read.
 */
export const PUSH_TEXT: Readonly<Record<NotificationType, { title: string; body: string }>> = {
  added_to_pick: { title: 'You’re in a Pick', body: 'Someone added you to a Pick.' },
  pick_started: { title: 'Time to swipe', body: 'Your Pick has started.' },
  reminder: { title: 'One hour left', body: 'You haven’t finished swiping yet.' },
  vote_needed: { title: 'Time to vote', body: 'Your Pick is down to a final vote.' },
  winner_decided: { title: 'It’s decided', body: 'Your Pick has a winner.' },
  pick_canceled: { title: 'Pick canceled', body: 'The host canceled a Pick.' },
  plan_time_set: { title: 'Plan time set', body: 'Your plan has a time. Are you going?' },
  plan_reminder: { title: 'Starting soon', body: 'Your plan starts in about an hour.' },
  did_you_go: { title: 'Did you go?', body: 'Tap to tell your group.' },
};

export interface NotificationRow {
  id: string;
  type: NotificationType;
  pickId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  readAt: string | null;
}

/** Database adapter (service role). */
export interface NotifyStore {
  /** Returns the users who got a new row; repeats of a once-per-Pick event return none. */
  insert(
    userIds: string[],
    type: NotificationType,
    pickId: string | null,
    payload: Record<string, unknown>,
  ): Promise<string[]>;
  tokensFor(userIds: string[]): Promise<string[]>;
  deleteTokens(tokens: string[]): Promise<void>;
  list(userId: string, limit: number): Promise<NotificationRow[]>;
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
  tokens: readonly string[],
  message: { title: string; body: string; data: Record<string, unknown> },
): Promise<string[]> {
  const dead: string[] = [];
  for (let i = 0; i < tokens.length; i += PUSH_BATCH) {
    const batch = tokens.slice(i, i + PUSH_BATCH);
    try {
      const res = await fetchFn(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(batch.map((to) => ({ to, sound: 'default', ...message }))),
        // A slow Expo must not hold up the close/cancel/vote that triggered this push.
        signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const tickets = ((await res.json()) as { data?: unknown }).data;
      if (!Array.isArray(tickets)) continue;
      tickets.forEach((t: { status?: string; details?: { error?: string } } | null, j) => {
        const token = batch[j];
        if (token && t?.status === 'error' && t.details?.error === 'DeviceNotRegistered') {
          dead.push(token);
        }
      });
    } catch {
      // One failed batch must not stop the rest.
    }
  }
  return dead;
}

export function createNotifier(
  store: NotifyStore,
  fetchFn: PushFetch,
  log: (...args: unknown[]) => void = console.error,
): Notifier {
  return async (userIds, type, pickId, payload = {}) => {
    if (!userIds.length) return;
    try {
      const fresh = await store.insert([...new Set(userIds)], type, pickId, payload);
      if (!fresh.length) return;
      const tokens = await store.tokensFor(fresh);
      if (!tokens.length) return;
      const dead = await sendPush(fetchFn, tokens, { ...PUSH_TEXT[type], data: { type, pickId } });
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

/** GET /notifications: my latest notifications, newest first. */
export async function listNotifications(store: NotifyStore, userId: string) {
  const notifications = await store.list(userId, INBOX_LIMIT);
  return { notifications, unreadCount: notifications.filter((n) => !n.readAt).length };
}

/** POST /notifications/:id/read. Someone else's id is a 404, same as an unknown one. */
export async function markNotificationRead(store: NotifyStore, id: string, userId: string) {
  if (!UUID_RE.test(id)) {
    throw new ApiError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found');
  }
  await store.markRead(id, userId);
  return { status: 'ok' as const };
}
