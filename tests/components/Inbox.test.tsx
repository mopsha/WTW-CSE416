import React from 'react';
import { AppState } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import InboxScreen from '../../app/inbox';
import { api } from '@/lib/api';
import type { NotificationRow } from '@shared/api/notify.ts';

const { create, act } = jest.requireActual('react-test-renderer');
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, useFocusEffect: jest.fn() }));
let mockViewer = 'me';
jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ session: { user: { id: mockViewer } } }),
}));
jest.mock('@/lib/api', () => ({
  api: {
    listNotifications: jest.fn(),
    revalidateNotifications: jest.fn(),
    markNotificationRead: jest.fn(),
  },
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
const times: Record<string, number> = {
  fresh: 9,
  new: 8,
  first: 6,
  middle: 5,
  boundary: 4,
  later: 2,
};
const notice = (id: string, readAt: string | null = null): NotificationRow => ({
  id,
  type: 'pick_canceled',
  pickId: `pick-${id}`,
  payload: { reason: `Private reason ${id}` },
  createdAt: `2026-11-03T12:00:00.00000${times[id] ?? 1}+00:00`,
  readAt,
});
function cursor(id: string) {
  return `${notice(id).createdAt}|${id}`;
}
const page = (ids: string[], nextCursor: string | null = null) => ({
  notifications: ids.map((id) => notice(id)),
  unreadCount: ids.length,
  nextCursor,
});
const latestFocus = () => jest.mocked(useFocusEffect).mock.calls.at(-1)![0];

beforeEach(() => {
  jest.resetAllMocks();
  mockViewer = 'me';
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  jest.mocked(api.markNotificationRead).mockResolvedValue({ status: 'ok' });
});

afterEach(() => jest.restoreAllMocks());

async function mount() {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(<InboxScreen />);
  });
  let blur: void | (() => void);
  async function focus() {
    await act(async () => {
      blur = latestFocus()();
    });
  }
  await focus();
  return {
    tree,
    focus,
    async blur() {
      await act(async () => {
        blur?.();
      });
    },
    async finish() {
      await act(async () => {
        blur?.();
        tree.unmount();
      });
    },
    async loadOlder() {
      await act(async () => tree.root.findByType('test-Button').props.onPress());
    },
    cards() {
      return tree.root.findAllByType('test-Card');
    },
  };
}

test('discovers new notices on return and preserves verified older rows, order, and read state', async () => {
  const readAt = '2026-11-03T13:00:00Z';
  jest
    .mocked(api.listNotifications)
    .mockResolvedValueOnce(page(['first'], cursor('first')))
    .mockResolvedValueOnce(page(['new', 'first'], cursor('first')));
  jest
    .mocked(api.revalidateNotifications)
    .mockResolvedValueOnce({
      notifications: [notice('first')],
      page: page(['middle', 'boundary'], cursor('boundary')),
    })
    .mockResolvedValueOnce({
      notifications: [notice('middle', readAt), notice('first', readAt)],
      page: undefined,
    })
    .mockResolvedValueOnce({
      notifications: [notice('new'), notice('first', readAt), notice('middle', readAt)],
      page: page(['first', 'later']),
    });

  const inbox = await mount();
  await inbox.loadOlder();
  expect(inbox.cards()).toHaveLength(3);
  await act(async () => inbox.cards()[1].props.onPress());
  expect(api.markNotificationRead).toHaveBeenCalledWith('middle', 'me');
  expect(router.push).toHaveBeenCalledWith('/pick/pick-middle');
  await inbox.blur();
  expect(inbox.cards()[1].props.accessibilityLabel).toBe('Checking notification');
  await inbox.focus();
  expect(api.listNotifications).toHaveBeenCalledTimes(2);
  expect(api.revalidateNotifications).toHaveBeenLastCalledWith(
    ['first', 'middle', 'boundary'],
    'me',
  );
  expect(inbox.cards()).toHaveLength(3);
  expect(inbox.cards()[0].props.accessibilityLabel).toContain('Private reason new');
  expect(inbox.cards()[1].props.accessibilityLabel).toContain('Private reason first');
  expect(inbox.cards()[1].props.accessibilityLabel).not.toContain('Unread');
  expect(inbox.cards()[2].props.accessibilityLabel).toContain('Private reason middle');
  expect(inbox.cards()[2].props.accessibilityLabel).not.toContain('Unread');

  await inbox.loadOlder();
  expect(api.revalidateNotifications).toHaveBeenLastCalledWith(
    ['new', 'first', 'middle'],
    'me',
    cursor('boundary'),
  );
  expect(inbox.cards()).toHaveLength(4);
  expect(inbox.cards()[3].props.accessibilityLabel).toContain('Private reason later');
  await inbox.finish();
});

test.each([true, false])(
  'foreground resets to the newest cursor when the loaded range has no overlap (old rows still visible: %p)',
  async (stillVisible) => {
    jest
      .mocked(api.listNotifications)
      .mockResolvedValueOnce(page(['first'], cursor('first')))
      .mockResolvedValueOnce(page(['fresh', 'new'], cursor('new')));
    jest
      .mocked(api.revalidateNotifications)
      .mockResolvedValueOnce({
        notifications: [notice('first')],
        page: page(['boundary'], cursor('boundary')),
      })
      .mockResolvedValueOnce({
        notifications: stillVisible ? [notice('first'), notice('boundary')] : [],
        page: undefined,
      })
      .mockResolvedValueOnce({
        notifications: [notice('fresh'), notice('new')],
        page: stillVisible ? page(['first'], cursor('first')) : page(['later']),
      });
    const inbox = await mount();
    await inbox.loadOlder();
    const change = jest.mocked(AppState.addEventListener).mock.calls.at(-1)![1];
    await act(async () => change('background'));
    await act(async () => change('active'));
    expect(inbox.cards()).toHaveLength(2);
    expect(inbox.cards()[0].props.accessibilityLabel).toContain('Private reason fresh');
    await inbox.loadOlder();
    expect(api.revalidateNotifications).toHaveBeenLastCalledWith(
      ['fresh', 'new'],
      'me',
      cursor('new'),
    );
    expect(inbox.cards()[2].props.accessibilityLabel).toContain(
      stillVisible ? 'Private reason first' : 'Private reason later',
    );
    await inbox.finish();
  },
);

test('a newer refresh supersedes load-more, and foreground coalesces with the refresh', async () => {
  let finishOlder!: (result: Awaited<ReturnType<typeof api.revalidateNotifications>>) => void;
  let finishNewest!: (result: Awaited<ReturnType<typeof api.listNotifications>>) => void;
  jest
    .mocked(api.listNotifications)
    .mockResolvedValueOnce(page(['first'], cursor('first')))
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finishNewest = resolve;
      }),
    );
  jest.mocked(api.revalidateNotifications).mockReturnValueOnce(
    new Promise((resolve) => {
      finishOlder = resolve;
    }),
  );
  const inbox = await mount();
  await inbox.loadOlder();
  await act(async () => inbox.tree.root.findByType('test-Screen').props.onRefresh());
  const change = jest.mocked(AppState.addEventListener).mock.calls.at(-1)![1];
  await act(async () => change('active'));
  expect(api.listNotifications).toHaveBeenCalledTimes(2);
  expect(inbox.cards()[0].props.accessibilityLabel).toBe('Checking notification');
  await act(async () => finishNewest(page(['fresh'])));
  await act(async () => finishOlder({ notifications: [notice('first')], page: page(['later']) }));
  expect(inbox.cards()).toHaveLength(1);
  expect(inbox.cards()[0].props.accessibilityLabel).toContain('Private reason fresh');
  await inbox.finish();
});

test('clears cached cancellation reasons when foreground revalidation fails and retries from page one', async () => {
  jest
    .mocked(api.listNotifications)
    .mockResolvedValueOnce(page(['first'], cursor('first')))
    .mockResolvedValueOnce(page(['new']))
    .mockResolvedValueOnce(page(['fresh']));
  jest
    .mocked(api.revalidateNotifications)
    .mockResolvedValueOnce({ notifications: [notice('first')], page: page(['second']) })
    .mockRejectedValueOnce(new Error('Revalidation failed'));
  const listener = jest.spyOn(AppState, 'addEventListener');
  const inbox = await mount();
  try {
    await inbox.loadOlder();
    const change = listener.mock.calls.at(-1)![1];
    await act(async () => change('background'));
    expect(
      inbox
        .cards()
        .every(
          (card: { props: { accessibilityLabel: string } }) =>
            !card.props.accessibilityLabel.includes('Private reason'),
        ),
    ).toBe(true);
    await act(async () => change('active'));
    expect(inbox.cards()).toHaveLength(0);
    const error = inbox.tree.root.findByType('test-ErrorState');
    expect(error.props.message).toBe('Revalidation failed');
    await act(async () => error.props.onRetry());
    expect(api.listNotifications).toHaveBeenLastCalledWith(undefined, 'me');
    expect(inbox.cards()).toHaveLength(1);
    expect(inbox.cards()[0].props.accessibilityLabel).toContain('Private reason fresh');
  } finally {
    await inbox.finish();
    listener.mockRestore();
  }
});

test('drops mounted rows immediately when the account changes', async () => {
  jest.mocked(api.listNotifications).mockResolvedValueOnce(page(['private']));
  const inbox = await mount();
  expect(inbox.cards()).toHaveLength(1);
  mockViewer = 'different-account';
  await act(async () => inbox.tree.update(<InboxScreen />));
  expect(inbox.cards()).toHaveLength(0);
  await inbox.finish();
});
