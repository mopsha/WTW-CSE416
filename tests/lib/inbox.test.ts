import { createApiClient } from '@/lib/api';
import { badgeText, inboxLabel, inboxRoute, inboxText } from '@/lib/inbox';
import { MOCK_ACCESS_TOKEN } from '@/lib/mock/auth';
import { MOCK_API_BASE_URL, mockFetch } from '@/lib/mock/api';
import { timeAgo } from '@/lib/time';
import type { NotificationRow } from '@shared/api/notify.ts';

const row = (over: Partial<NotificationRow> = {}): NotificationRow => ({
  id: 'n1',
  type: 'winner_decided',
  pickId: 'p1',
  payload: {},
  createdAt: '2026-11-01T12:00:00Z',
  readAt: null,
  ...over,
});
const NOW = new Date('2026-11-01T12:30:00Z');

describe('inboxText', () => {
  test('uses the same wording as the push', () => {
    expect(inboxText(row())).toEqual({ title: 'It’s decided', body: 'Your Pick has a winner.' });
  });

  test('adds a cancel reason, which never goes in push text', () => {
    expect(inboxText(row({ type: 'pick_canceled', payload: { reason: 'Rain' } })).body).toBe(
      'The host canceled a Pick. “Rain”',
    );
  });

  test.each([{}, { reason: '' }, { reason: 42 }])('ignores payload %j', (payload) => {
    expect(inboxText(row({ type: 'pick_canceled', payload })).body).toBe(
      'The host canceled a Pick.',
    );
  });

  test('an unknown type from a newer server still renders', () => {
    expect(inboxText(row({ type: 'brand_new' as NotificationRow['type'] })).title).toBe('WTW');
  });
});

test('a row opens its Pick; one with no Pick opens nothing', () => {
  expect(inboxRoute(row())).toBe('/pick/p1');
  expect(inboxRoute(row({ pickId: null }))).toBeNull();
});

test('screen readers hear whether a row is unread', () => {
  expect(inboxLabel(row(), NOW)).toBe('Unread. It’s decided. Your Pick has a winner. 30m ago.');
  expect(inboxLabel(row({ readAt: '2026-11-01T12:10:00Z' }), NOW)).toBe(
    'It’s decided. Your Pick has a winner. 30m ago.',
  );
});

test.each([
  [0, null],
  [-1, null],
  [1, '1'],
  [9, '9'],
  [10, '9+'],
  [50, '9+'],
])('badge for %i is %p', (unread, text) => {
  expect(badgeText(unread)).toBe(text);
});

test('timeAgo', () => {
  const at = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
  expect(timeAgo(at(10_000), NOW)).toBe('just now');
  expect(timeAgo(at(5 * 60_000), NOW)).toBe('5m ago');
  expect(timeAgo(at(3 * 3_600_000), NOW)).toBe('3h ago');
  expect(timeAgo('not a date', NOW)).toBe('');
});

test('marking a mock notification read lowers the unread count, and repeats are safe', async () => {
  const api = createApiClient({
    baseUrl: MOCK_API_BASE_URL,
    getAccessToken: async () => MOCK_ACCESS_TOKEN,
    fetch: mockFetch,
  });
  const before = await api.listNotifications();
  const unread = before.notifications.find((n) => !n.readAt)!;
  await api.markNotificationRead(unread.id);
  await api.markNotificationRead(unread.id);
  await expect(api.listNotifications()).resolves.toMatchObject({
    unreadCount: before.unreadCount - 1,
  });
});
