import React from 'react';
import { AppState } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import InboxScreen from '../../app/inbox';
import { api, ApiError } from '@/lib/api';
import type { NotificationRow } from '@shared/api/notify.ts';

const { create, act } = jest.requireActual('react-test-renderer');
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, useFocusEffect: jest.fn() }));
let mockViewer = 'me';
jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ session: { user: { id: mockViewer } } }),
}));
jest.mock('@/lib/api', () => ({
  ApiError: jest.requireActual('@/lib/api').ApiError,
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
      ['Screen', 'Card', 'Button', 'ErrorState', 'EmptyState', 'Avatar'].map((name) => [
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
  jest.mocked(api.listNotifications).mockResolvedValueOnce(page(['first'], cursor('first')));
  jest
    .mocked(api.revalidateNotifications)
    .mockResolvedValueOnce({
      notifications: [notice('first')],
      page: page(['middle', 'boundary'], cursor('boundary')),
    })
    .mockResolvedValueOnce({
      notifications: [notice('middle', readAt), notice('first', readAt)],
      page: {
        ...page(['new', 'first'], cursor('first')),
        notifications: [notice('new'), notice('first', readAt)],
      },
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
  expect(inbox.cards()).toHaveLength(0);
  expect(
    inbox.tree.root.findAllByProps({ accessibilityElementsHidden: true }).length,
  ).toBeGreaterThan(0);
  await inbox.focus();
  expect(api.listNotifications).toHaveBeenCalledTimes(1);
  expect(api.revalidateNotifications).toHaveBeenLastCalledWith(
    ['first', 'middle', 'boundary'],
    'me',
    undefined,
    true,
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
    jest.mocked(api.listNotifications).mockResolvedValueOnce(page(['first'], cursor('first')));
    jest
      .mocked(api.revalidateNotifications)
      .mockResolvedValueOnce({
        notifications: [notice('first')],
        page: page(['boundary'], cursor('boundary')),
      })
      .mockResolvedValueOnce({
        notifications: stillVisible ? [notice('first'), notice('boundary')] : [],
        page: page(['fresh', 'new'], cursor('new')),
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
  expect(inbox.cards()).toHaveLength(0);
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
    expect(inbox.cards()).toHaveLength(0);
    await act(async () => change('active'));
    expect(inbox.cards()).toHaveLength(0);
    const error = inbox.tree.root.findByType('test-ErrorState');
    expect(error.props).toMatchObject({
      message: 'Couldn’t refresh activity. Revalidation failed',
      variant: 'banner',
    });
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

test('Activity uses authorized photo references and falls back to initials', async () => {
  const avatarRef = { userId: 'alex', revision: 1 };
  jest.mocked(api.listNotifications).mockResolvedValueOnce({
    ...page([]),
    notifications: [
      {
        ...notice('alex'),
        type: 'friend_request',
        activity: { actorId: 'alex', actorName: 'Alex', avatarRef },
      },
      {
        ...notice('jordan'),
        type: 'friend_accepted',
        activity: { actorId: 'jordan', actorName: 'Jordan' },
      },
    ],
  });
  const inbox = await mount();
  const avatars = inbox.tree.root.findAllByType('test-Avatar');
  expect(avatars[0].props).toMatchObject({ name: 'Alex', avatarRef });
  expect(avatars[1].props.name).toBe('Jordan');
  expect(avatars[1].props.avatarRef).toBeUndefined();
  expect(inbox.cards()[0].props.accessibilityLabel).toContain('Alex sent you a friend request.');
  expect(inbox.cards()[1].props.accessibilityLabel).toContain(
    'Jordan accepted your friend request.',
  );
  await inbox.finish();
});

test('the refreshed Hang group shows the authorized actor, count and unread state as one row', async () => {
  const row: NotificationRow = {
    ...notice('first', '2026-11-03T13:00:00Z'),
    type: 'hang_rsvp',
    pickId: null,
    payload: { hangId: 'hang' },
    activity: {
      actorId: 'jordan',
      actorName: 'Jordan',
      avatarRef: { userId: 'jordan', revision: 2 },
      replyStatus: 'down',
      replyCount: 2,
      hangName: 'Coffee',
    },
  };
  const changed: NotificationRow = {
    ...row,
    activityAt: notice('fresh').createdAt,
    readAt: null,
    activity: {
      actorId: 'maya',
      actorName: 'Maya',
      replyStatus: 'maybe',
      replyCount: 1,
      hangName: 'Coffee',
    },
  };
  jest.mocked(api.listNotifications).mockResolvedValueOnce({
    ...page([], cursor('first')),
    notifications: [row],
    orderVersion: '1',
  });
  jest
    .mocked(api.revalidateNotifications)
    .mockResolvedValueOnce({
      notifications: [row],
      page: { ...page(['middle']), orderVersion: '1' },
    })
    .mockResolvedValueOnce({
      notifications: [changed, notice('middle')],
      page: { ...page([], cursor('boundary')), notifications: [changed], orderVersion: '2' },
    });
  const inbox = await mount();
  await inbox.loadOlder();
  expect(inbox.cards()[0].props.accessibilityLabel).toContain('Jordan and 1 other');
  await inbox.blur();
  await inbox.focus();
  expect(inbox.cards()).toHaveLength(1);
  expect(inbox.cards()[0].props.accessibilityLabel).toContain('Unread');
  expect(inbox.cards()[0].props.accessibilityLabel).toContain('Maya');
  expect(inbox.cards()[0].props.accessibilityLabel).not.toContain('Jordan');
  expect(inbox.cards()[0].props.accessibilityLabel).not.toContain('other');
  expect(inbox.tree.root.findByType('test-Avatar').props.avatarRef).toBeUndefined();
  await inbox.finish();
});

test('load-more restarts at the server head when a Hang moved across the old cursor', async () => {
  jest.mocked(api.listNotifications).mockResolvedValueOnce({
    ...page(['first'], `${cursor('first')}|1`),
    orderVersion: '1',
  });
  jest
    .mocked(api.revalidateNotifications)
    .mockResolvedValueOnce({
      notifications: [],
      page: { ...page(['fresh', 'new'], `${cursor('new')}|2`), orderVersion: '2', reset: true },
    })
    .mockResolvedValueOnce({
      notifications: [notice('fresh'), notice('new')],
      page: { ...page(['first', 'later']), orderVersion: '2' },
    });

  const inbox = await mount();
  await inbox.loadOlder();
  expect(
    inbox
      .cards()
      .map((card: { props: { accessibilityLabel: string } }) => card.props.accessibilityLabel),
  ).toEqual([
    expect.stringContaining('Private reason fresh'),
    expect.stringContaining('Private reason new'),
  ]);
  await inbox.loadOlder();
  expect(api.revalidateNotifications).toHaveBeenLastCalledWith(
    ['fresh', 'new'],
    'me',
    `${cursor('new')}|2`,
  );
  expect(inbox.cards()).toHaveLength(4);
  expect(inbox.cards()[2].props.accessibilityLabel).toContain('Private reason first');
  await inbox.finish();
});

test('failed pagination keeps only separately authorized rows and retries the same cursor', async () => {
  jest
    .mocked(api.listNotifications)
    .mockResolvedValueOnce(page(['first', 'boundary'], cursor('boundary')));
  jest
    .mocked(api.revalidateNotifications)
    .mockRejectedValueOnce(new Error('Page failed'))
    .mockResolvedValueOnce({ notifications: [notice('first')] })
    .mockResolvedValueOnce({ notifications: [notice('first')], page: page(['later']) });
  const inbox = await mount();
  try {
    await inbox.loadOlder();
    expect(api.revalidateNotifications).toHaveBeenLastCalledWith(['first', 'boundary'], 'me');
    expect(inbox.cards()).toHaveLength(1);
    expect(inbox.cards()[0].props.accessibilityLabel).toContain('Private reason first');
    const error = inbox.tree.root.findByType('test-ErrorState');
    expect(error.props).toMatchObject({
      variant: 'banner',
      message: 'Couldn’t load older activity. Page failed',
    });
    await act(async () => error.props.onRetry());
    expect(api.revalidateNotifications).toHaveBeenLastCalledWith(
      ['first'],
      'me',
      cursor('boundary'),
    );
    expect(inbox.cards()).toHaveLength(2);
    expect(inbox.cards()[1].props.accessibilityLabel).toContain('Private reason later');
    expect(inbox.tree.root.findAllByType('test-ErrorState')).toHaveLength(0);
  } finally {
    await inbox.finish();
  }
});

test('when pagination and its access check fail, retry starts with a fresh page', async () => {
  jest
    .mocked(api.listNotifications)
    .mockResolvedValueOnce(page(['first'], cursor('first')))
    .mockResolvedValueOnce(page(['fresh']));
  jest
    .mocked(api.revalidateNotifications)
    .mockRejectedValueOnce(new Error('Page failed'))
    .mockRejectedValueOnce(new Error('Access check failed'));
  const inbox = await mount();
  try {
    await inbox.loadOlder();
    expect(inbox.cards()).toHaveLength(0);
    const error = inbox.tree.root.findByType('test-ErrorState');
    expect(error.props).toMatchObject({
      variant: 'banner',
      message: 'Couldn’t load older activity. Access check failed',
    });
    await act(async () => error.props.onRetry());
    expect(api.listNotifications).toHaveBeenLastCalledWith(undefined, 'me');
    expect(inbox.cards()[0].props.accessibilityLabel).toContain('Private reason fresh');
  } finally {
    await inbox.finish();
  }
});

test('an API without revalidation displays only the freshly fetched page', async () => {
  jest
    .mocked(api.listNotifications)
    .mockResolvedValueOnce(page(['first'], cursor('first')))
    .mockResolvedValueOnce(page(['later']));
  jest
    .mocked(api.revalidateNotifications)
    .mockRejectedValueOnce(new ApiError('NOT_FOUND', 'Route not found', 404));
  const inbox = await mount();
  try {
    await inbox.loadOlder();
    expect(api.listNotifications).toHaveBeenLastCalledWith(cursor('first'), 'me');
    expect(inbox.cards()).toHaveLength(1);
    expect(inbox.cards()[0].props.accessibilityLabel).toContain('Private reason later');
    expect(inbox.tree.root.findAllByType('test-ErrorState')).toHaveLength(0);
  } finally {
    await inbox.finish();
  }
});

test('initial failure gets a full error and retries the initial load', async () => {
  jest
    .mocked(api.listNotifications)
    .mockRejectedValueOnce(new Error('Offline'))
    .mockResolvedValueOnce(page(['first']));
  const inbox = await mount();
  try {
    const error = inbox.tree.root.findByType('test-ErrorState');
    expect(error.props).toMatchObject({ variant: 'full', message: 'Offline' });
    await act(async () => error.props.onRetry());
    expect(inbox.cards()).toHaveLength(1);
  } finally {
    await inbox.finish();
  }
});

test('an account switch discards a pending pagination recovery', async () => {
  let authorize!: (result: Awaited<ReturnType<typeof api.revalidateNotifications>>) => void;
  jest
    .mocked(api.listNotifications)
    .mockResolvedValueOnce(page(['first'], cursor('first')))
    .mockResolvedValueOnce(page(['fresh']));
  jest
    .mocked(api.revalidateNotifications)
    .mockRejectedValueOnce(new Error('Page failed'))
    .mockReturnValueOnce(
      new Promise((resolve) => {
        authorize = resolve;
      }),
    );
  const inbox = await mount();
  try {
    await inbox.loadOlder();
    await inbox.blur();
    mockViewer = 'another-account';
    await act(async () => inbox.tree.update(<InboxScreen />));
    await inbox.focus();
    await act(async () => authorize({ notifications: [notice('first')] }));
    expect(api.listNotifications).toHaveBeenLastCalledWith(undefined, 'another-account');
    expect(inbox.cards()).toHaveLength(1);
    expect(inbox.cards()[0].props.accessibilityLabel).toContain('Private reason fresh');
    expect(inbox.tree.root.findAllByType('test-ErrorState')).toHaveLength(0);
  } finally {
    await inbox.finish();
  }
});
