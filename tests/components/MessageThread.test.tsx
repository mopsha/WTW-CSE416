import React from 'react';
import {
  Platform,
  ScrollView,
  Text,
  RefreshControl,
  ActivityIndicator,
  StyleSheet,
  TextInput,
} from 'react-native';
import { MessageThread, type MessageThreadState } from '@/components/MessageThread';
import { MESSAGE_MAX } from '@shared/api/messages.ts';
jest.mock('@/hooks/useAvatarSource', () => ({
  useAvatarSource: () => null,
  useAvatarPhoto: () => ({
    uri: null,
    ref: null,
    displayed: false,
    displayKey: undefined,
    onDisplay: () => {},
  }),
}));
const { create, act } = jest.requireActual('react-test-renderer');
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/components', () => ({
  ...jest.requireActual('@/components/theme'),
  Avatar: () => null,
  ErrorState: (p: object) => jest.requireActual('react').createElement('test-error', p),
  Button: (p: object) => jest.requireActual('react').createElement('test-button', p),
}));
const base: MessageThreadState = {
  messages: [],
  loading: false,
  error: null,
  unavailable: false,
  mode: 'realtime',
  refresh: jest.fn().mockResolvedValue(undefined),
};
const props = {
  userId: 'me',
  reportKind: 'direct_message' as const,
  title: 'Direct chat',
  emptyText: 'No messages yet.',
  placeholder: 'Message…',
  inputLabel: 'Direct message',
  onSend: jest.fn(),
};
async function mount(chat: MessageThreadState = base, group = false) {
  let tree: any;
  await act(async () => {
    tree = create(<MessageThread {...props} chat={chat} group={group} />);
  });
  return tree;
}
test('empty thread keeps the accessible composer, and unavailable chat disables sending', async () => {
  const tree = await mount({ ...base, unavailable: true });
  expect(
    tree.root.findAllByType(Text).some((n: any) => n.props.children === 'No messages yet.'),
  ).toBe(true);
  expect(tree.root.findByType('test-button').props.accessibilityLabel).toBe('Send message');
  expect(tree.root.findByType('test-button').props.disabled).toBe(true);
  expect(tree.root.findAllByProps({ accessibilityLabel: 'Direct message' })[0].props.editable).toBe(
    false,
  );
  await act(async () => tree.unmount());
});
test('ordered group bubbles retain sender names, timestamps and long/multiline content', async () => {
  const messages = ['First message', 'A second\nline', 'My reply'].map((body, i) => ({
    id: String(i),
    senderId: i === 2 ? 'me' : 'ava',
    senderName: 'Ava',
    senderUsername: 'ava',
    senderAvatarUrl: null,
    body,
    createdAt: `2026-11-03T12:0${i}:00Z`,
  }));
  const tree = await mount({ ...base, messages }, true);
  const bubbles = tree.root.findAll(
    (n: any) =>
      typeof n.type === 'string' &&
      n.props.accessible &&
      typeof n.props.accessibilityLabel === 'string' &&
      n.props.accessibilityLabel.includes(': '),
  );
  expect(bubbles.map((n: any) => n.props.accessibilityLabel.split(': ').at(-1))).toEqual(
    messages.map((m) => m.body),
  );
  expect(bubbles[2].props.accessibilityLabel).toMatch(/^You,/);
  expect(
    tree.root
      .findAllByType(Text)
      .some((n: any) => String(n.props.children).includes('latest 50 messages')),
  ).toBe(false);
  await act(async () => tree.unmount());
});
test('validation preserves oversized drafts and never calls the send contract', async () => {
  const tree = await mount();
  const input = tree.root.findAllByProps({ accessibilityLabel: 'Direct message' })[0];
  const draft = 'x'.repeat(MESSAGE_MAX + 1);
  await act(async () => input.props.onChangeText(draft));
  await act(async () => tree.root.findByType('test-button').props.onPress());
  expect(props.onSend).not.toHaveBeenCalled();
  expect(tree.root.findByType('test-error')).toBeTruthy();
  expect(tree.root.findAllByProps({ accessibilityLabel: 'Direct message' })[0].props.value).toBe(
    draft,
  );
  await act(async () => tree.unmount());
});

test.each(['ios', 'android'] as const)(
  'keyboard dismissal uses the platform convention (%s)',
  async (platform) => {
    const os = jest.replaceProperty(Platform, 'OS', platform);
    try {
      const tree = await mount();
      expect(tree.root.findByType(ScrollView).props.keyboardDismissMode).toBe(
        platform === 'ios' ? 'interactive' : 'on-drag',
      );
      await act(async () => tree.unmount());
    } finally {
      os.restore();
    }
  },
);
test.each([
  ['realtime', 'Live updates'],
  ['connecting', 'Connecting…'],
  ['polling', 'Refreshes every 5 seconds'],
] as const)(
  'quiet context retains the existing status and history bound (%s)',
  async (mode, label) => {
    const tree = await mount({ ...base, mode, loading: true });
    const context = tree.root
      .findAllByType(Text)
      .find((n: any) => n.props.accessibilityLiveRegion === 'polite');
    expect(context.props.children.join('')).toBe(`${label} · latest 50 messages`);
    expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(1);
    expect(tree.root.findByType(RefreshControl).props.refreshing).toBe(false);
    await act(async () => tree.unmount());
  },
);

test.each([
  ['Next message', 'Next message'],
  ['First message there', ' there'],
  ['First message', ''],
])(
  'sending keeps focus eligibility and preserves an edited next draft: %s',
  async (nextDraft, expected) => {
    let finish!: () => void;
    props.onSend.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const tree = await mount();
    await act(async () => tree.root.findByType(TextInput).props.onChangeText('First message'));
    await act(async () => {
      tree.root.findByType('test-button').props.onPress();
      tree.root.findByType('test-button').props.onPress();
    });
    expect(props.onSend).toHaveBeenCalledTimes(1);
    expect(tree.root.findByType(TextInput).props.editable).toBe(true);
    await act(async () => tree.root.findByType(TextInput).props.onChangeText(nextDraft));
    await act(async () => finish());
    expect(tree.root.findByType(TextInput).props.value).toBe(expected);
    await act(async () => tree.unmount());
    props.onSend.mockClear();
  },
);

test('manual refresh waits for both requests, ignores repeated pulls and ends after errors', async () => {
  let historyDone!: () => void, auxiliaryDone!: () => void;
  const refresh = jest.fn(
    () =>
      new Promise<void>((resolve) => {
        historyDone = resolve;
      }),
  );
  const auxiliary = jest.fn(
    () =>
      new Promise<void>((resolve) => {
        auxiliaryDone = resolve;
      }),
  );
  let tree: any;
  await act(async () => {
    tree = create(<MessageThread {...props} chat={{ ...base, refresh }} onRefresh={auxiliary} />);
  });
  const control = () => tree.root.findByType(RefreshControl);
  expect(control().props.refreshing).toBe(false);
  await act(async () => {
    control().props.onRefresh();
    control().props.onRefresh();
  });
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(auxiliary).toHaveBeenCalledTimes(1);
  expect(control().props.refreshing).toBe(true);
  await act(async () => historyDone());
  expect(control().props.refreshing).toBe(true);
  await act(async () => auxiliaryDone());
  expect(control().props.refreshing).toBe(false);
  refresh.mockRejectedValueOnce(new Error('Offline'));
  await act(async () => control().props.onRefresh());
  expect(control().props.refreshing).toBe(true);
  await act(async () => auxiliaryDone());
  expect(control().props.refreshing).toBe(false);
  expect(tree.root.findByType('test-error').props.message).toBe('Offline');
  await act(async () => tree.unmount());
});

test('chat notices have their own inset without narrowing the history', async () => {
  const tree = await mount({ ...base, error: 'Offline' });
  const error = tree.root.findByType('test-error');
  let notice = error.parent;
  while (notice && StyleSheet.flatten(notice.props.style)?.marginHorizontal === undefined)
    notice = notice.parent;
  expect(StyleSheet.flatten(notice.props.style).marginHorizontal).toBeGreaterThan(0);
  expect(
    StyleSheet.flatten(tree.root.findByType(ScrollView).props.style).marginHorizontal,
  ).toBeUndefined();
  await act(async () => tree.unmount());
});

test('success clears an unchanged draft and releases sending before history finishes', async () => {
  let historyDone!: () => void;
  const refresh = jest.fn(
    () =>
      new Promise<void>((resolve) => {
        historyDone = resolve;
      }),
  );
  props.onSend.mockClear();
  props.onSend.mockResolvedValue(undefined);
  let tree: any;
  await act(async () => {
    tree = create(<MessageThread {...props} chat={{ ...base, refresh }} />);
  });
  await act(async () => tree.root.findByType(TextInput).props.onChangeText('First'));
  await act(async () => tree.root.findByType('test-button').props.onPress());
  expect(tree.root.findByType(TextInput).props.value).toBe('');
  expect(tree.root.findByType('test-button').props.loading).toBe(false);
  await act(async () => tree.root.findByType(TextInput).props.onChangeText('Second'));
  await act(async () => tree.root.findByType('test-button').props.onPress());
  expect(props.onSend).toHaveBeenCalledTimes(2);
  expect(props.onSend.mock.calls[0][0].clientId).not.toBe(props.onSend.mock.calls[1][0].clientId);
  await act(async () => historyDone());
  await act(async () => tree.unmount());
  props.onSend.mockClear();
});

test('failed delivery preserves appended text and unchanged retries retain their ID', async () => {
  let fail!: (e: Error) => void;
  props.onSend.mockClear();
  props.onSend.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  const tree = await mount();
  await act(async () => tree.root.findByType(TextInput).props.onChangeText('Hello'));
  await act(async () => tree.root.findByType('test-button').props.onPress());
  await act(async () => tree.root.findByType(TextInput).props.onChangeText('Hello there'));
  await act(async () => fail(new Error('Offline')));
  expect(tree.root.findByType(TextInput).props.value).toBe('Hello there');
  await act(async () => tree.root.findByType(TextInput).props.onChangeText('Hello'));
  props.onSend.mockResolvedValueOnce(undefined);
  await act(async () => tree.root.findByType('test-button').props.onPress());
  expect(props.onSend.mock.calls[1][0].clientId).toBe(props.onSend.mock.calls[0][0].clientId);
  await act(async () => tree.unmount());
  props.onSend.mockClear();
});

test('a late refresh rejection after unmount is handled independently of delivery', async () => {
  let fail!: (e: Error) => void;
  props.onSend.mockResolvedValueOnce(undefined);
  const refresh = () =>
    new Promise<void>((_resolve, reject) => {
      fail = reject;
    });
  const tree = await mount({ ...base, refresh });
  await act(async () => tree.root.findByType(TextInput).props.onChangeText('Hello'));
  await act(async () => tree.root.findByType('test-button').props.onPress());
  await act(async () => tree.unmount());
  await act(async () => fail(new Error('Offline')));
  props.onSend.mockClear();
});

test('delivery completing after unmount does not start history reconciliation', async () => {
  let finish!: () => void;
  props.onSend.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const refresh = jest.fn(async () => {});
  const tree = await mount({ ...base, refresh });
  await act(async () => tree.root.findByType(TextInput).props.onChangeText('Hello'));
  await act(async () => tree.root.findByType('test-button').props.onPress());
  await act(async () => tree.unmount());
  await act(async () => finish());
  expect(refresh).not.toHaveBeenCalled();
  props.onSend.mockClear();
});

test('route-owned viewport survives remount and restores position after history revalidation', async () => {
  const { emptyMessageDraft } = jest.requireActual('@/components/MessageThread');
  const draft = emptyMessageDraft();
  let tree: any;
  await act(async () => {
    tree = create(<MessageThread {...props} chat={base} composerRef={draft} />);
  });
  await act(async () =>
    tree.root.findByType(ScrollView).props.onScroll({
      nativeEvent: {
        layoutMeasurement: { height: 400 },
        contentOffset: { y: 120 },
        contentSize: { height: 1000 },
      },
    }),
  );
  expect(draft.current.viewport).toEqual({ offset: 120, atBottom: false });
  await act(async () => tree.unmount());
  await act(async () => {
    tree = create(<MessageThread {...props} chat={base} composerRef={draft} />);
  });
  const scroll = tree.root.findByType(ScrollView);
  const restore = jest.spyOn(scroll.instance, 'scrollTo').mockImplementation(() => {});
  await act(async () => scroll.props.onContentSizeChange());
  expect(restore).toHaveBeenCalledWith({ y: 120, animated: false });
  restore.mockRestore();
  await act(async () => tree.unmount());
});
