import React from 'react';
import { router, useFocusEffect } from 'expo-router';
import InboxScreen from '../../app/inbox';
import { api } from '@/lib/api';
import type { NotificationRow } from '@shared/api/notify.ts';

const { create, act } = jest.requireActual('react-test-renderer');
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, useFocusEffect: jest.fn() }));
jest.mock('@/lib/api', () => ({
  api: { listNotifications: jest.fn(), markNotificationRead: jest.fn() },
}));
jest.mock('@/components', () => {
  const React = jest.requireActual('react');
  return {
    ...jest.requireActual('@/components/theme'),
    ...Object.fromEntries(
      ['Screen', 'Card', 'Button', 'ErrorState', 'EmptyState'].map((name) => [
        name,
        (props: object) => React.createElement(`test-${name}`, props),
      ]),
    ),
  };
});
const notice = (id: string): NotificationRow => ({
  id,
  type: 'reminder',
  pickId: `pick-${id}`,
  payload: {},
  createdAt: '2026-11-03T12:00:00Z',
  readAt: null,
});
beforeEach(() => jest.clearAllMocks());
test('returning from an older notification preserves loaded pages and cursor; explicit refresh reloads', async () => {
  jest
    .mocked(api.listNotifications)
    .mockResolvedValueOnce({
      notifications: [notice('first')],
      unreadCount: 1,
      nextCursor: 'older',
    })
    .mockResolvedValueOnce({
      notifications: [notice('second')],
      unreadCount: 1,
      nextCursor: 'oldest',
    })
    .mockResolvedValueOnce({ notifications: [notice('newest')], unreadCount: 1, nextCursor: null });
  jest.mocked(api.markNotificationRead).mockResolvedValue({ status: 'ok' });
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(<InboxScreen />);
  });
  const focus = () => jest.mocked(useFocusEffect).mock.calls.at(-1)![0]();
  await act(async () => {
    focus();
  });
  await act(async () => tree.root.findByType('test-Button').props.onPress());
  expect(api.listNotifications).toHaveBeenLastCalledWith('older');
  expect(tree.root.findAllByType('test-Card')).toHaveLength(2);
  await act(async () => tree.root.findAllByType('test-Card')[1].props.onPress());
  expect(router.push).toHaveBeenCalledWith('/pick/pick-second');
  expect(api.markNotificationRead).toHaveBeenCalledWith('second');
  await act(async () => {
    focus();
  });
  expect(api.listNotifications).toHaveBeenCalledTimes(2);
  expect(tree.root.findAllByType('test-Card')).toHaveLength(2);
  expect(tree.root.findAllByType('test-Card')[1].props.accessibilityLabel).not.toContain('Unread.');
  expect(tree.root.findByType('test-Button').props.label).toBe('Load older notifications');
  await act(async () => tree.root.findByType('test-Screen').props.onRefresh());
  expect(api.listNotifications).toHaveBeenCalledTimes(3);
  expect(tree.root.findAllByType('test-Card')).toHaveLength(1);
  expect(tree.root.findAllByType('test-Button')).toHaveLength(0);
  await act(async () => tree.unmount());
});
test('returning after an initial failure retries instead of preserving an empty failed load', async () => {
  jest
    .mocked(api.listNotifications)
    .mockRejectedValueOnce(new Error('Offline'))
    .mockResolvedValueOnce({ notifications: [notice('retry')], unreadCount: 1 });
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(<InboxScreen />);
  });
  const focus = () => jest.mocked(useFocusEffect).mock.calls.at(-1)![0]();
  await act(async () => {
    focus();
  });
  expect(tree.root.findByType('test-ErrorState').props.message).toBe('Offline');
  await act(async () => {
    focus();
  });
  expect(tree.root.findAllByType('test-Card')).toHaveLength(1);
  await act(async () => tree.unmount());
});
