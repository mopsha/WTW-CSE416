import { api } from '@/lib/api';
import { confirmAction } from '@/lib/confirm';
import React from 'react';
import DirectMessageScreen from '../../app/messages/[id]';
import { useDirectChat } from '@/hooks/useDirectChat';
const { create, act } = jest.requireActual('react-test-renderer');
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ id: 'conversation' }) }));
jest.mock('@/hooks/useAvatarSource', () => ({
  useAvatarPhoto: () => ({ uri: null, ref: null }),
  usePhotoCapabilities: () => ({
    uploadsEnabled: false,
    reportsEnabled: false,
    refresh: async () => {},
  }),
}));
jest.mock('@/hooks/useAuth', () => ({ useSession: () => ({ user: { id: 'me' } }) }));
jest.mock('@/hooks/useDirectChat', () => ({ useDirectChat: jest.fn() }));
jest.mock('@/components', () => ({
  Screen: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/components/ConversationHeader', () => ({
  ConversationHeader: (p: { right?: React.ReactNode }) =>
    jest.requireActual('react').createElement('test-header', p, p.right),
}));
jest.mock('@/components/MessageThread', () => ({
  MessageThread: (p: object) => jest.requireActual('react').createElement('test-thread', p),
}));
jest.mock('@/lib/api', () => ({
  api: { sendDirectMessage: jest.fn(), report: jest.fn(), blockUser: jest.fn() },
}));
jest.mock('@/lib/confirm', () => ({ confirmAction: jest.fn() }));
jest.mock('@/components/HostMenu', () => ({
  menuStyles: {},
  MenuItem: (props: object) => jest.requireActual('react').createElement('test-item', props),
}));
jest.mock('@/components/ErrorBanner', () => ({ ErrorBanner: () => null }));
const base: ReturnType<typeof useDirectChat> = {
  conversation: null,
  messages: [],
  loading: true,
  error: null,
  unavailable: false,
  mode: 'connecting',
  refresh: async () => {},
};
test.each([
  ['initial', true, null, false, true],
  ['background/awaiting revalidation', false, null, false, true],
  ['failed refresh', false, 'Offline', false, false],
  ['revoked/missing conversation', false, 'Unavailable', true, false],
] as const)(
  '%s never presents an invented peer',
  async (_label, loading, error, unavailable, headerLoading) => {
    jest.mocked(useDirectChat).mockReturnValue({ ...base, loading, error, unavailable });
    let tree: any;
    await act(async () => {
      tree = create(<DirectMessageScreen />);
    });
    expect(tree.root.findByType('test-header').props.right).toBeUndefined();
    expect(tree.root.findByType('test-header').props.name).toBeUndefined();
    expect(tree.root.findByType('test-header').props.loading).toBe(headerLoading);
    expect(tree.root.findByType('test-header').props.unavailable).toBe(unavailable);
    expect(tree.root.findByType('test-thread').props.chat.unavailable).toBe(true);
    await act(async () => tree.unmount());
  },
);
test('a verified peer retains their actual identity and messages remain available', async () => {
  jest.mocked(useDirectChat).mockReturnValue({
    ...base,
    loading: false,
    conversation: {
      id: 'conversation',
      createdAt: '2026-11-03',
      peer: { id: 'friend', displayName: 'Ava', username: 'ava', avatarUrl: null },
    },
  });
  let tree: any;
  await act(async () => {
    tree = create(<DirectMessageScreen />);
  });
  expect(tree.root.findByType('test-thread').props.reportKind).toBe('direct_message');
  expect(tree.root.findByType('test-header').props.name).toBe('Ava');
  expect(tree.root.findByType('test-header').props.subtitle).toBe('@ava');
  expect(tree.root.findByType('test-thread').props.chat.unavailable).toBe(false);
  await act(async () => tree.unmount());
});

test('verified direct-chat peer menu reports and blocks the peer, then refreshes access', async () => {
  const refresh = jest.fn().mockResolvedValue(undefined);
  jest.mocked(useDirectChat).mockReturnValue({
    ...base,
    loading: false,
    refresh,
    conversation: {
      id: 'conversation',
      createdAt: '2026-11-03',
      peer: { id: 'friend', displayName: 'Ava', username: 'ava', avatarUrl: null },
    },
  });
  jest.mocked(api.report).mockResolvedValue({ status: 'ok' });
  jest.mocked(api.blockUser).mockResolvedValue({ status: 'ok' });
  jest.mocked(confirmAction).mockResolvedValue(true);
  let tree: any;
  await act(async () => {
    tree = create(<DirectMessageScreen />);
  });
  const trigger = () =>
    tree.root
      .findAllByProps({ accessibilityLabel: 'Options for Ava' })
      .find((n: any) => typeof n.props.onPress === 'function');
  const item = (label: string) =>
    tree.root.findAllByType('test-item').find((n: any) => n.props.label === label);
  await act(async () => trigger().props.onPress());
  await act(async () => item('Report').props.onPress());
  await act(async () => item('Spam or a fake account').props.onPress());
  expect(api.report).toHaveBeenCalledWith({
    kind: 'user',
    targetId: 'friend',
    reason: 'Spam or a fake account',
  });
  await act(async () => item('Thanks. We’ll look into Ava.').props.onPress());
  await act(async () => trigger().props.onPress());
  await act(async () => item('Block').props.onPress());
  expect(api.blockUser).toHaveBeenCalledWith('friend');
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(async () => tree.unmount());
});

test.each([
  ['Ava', 'ava', 'Ava'],
  [null, 'ava', '@ava'],
  ['', 'ava', '@ava'],
  [null, null, 'WTW friend'],
  ['', '', 'WTW friend'],
])(
  'header and peer menu share the label for displayName=%s username=%s',
  async (displayName, username, label) => {
    jest.mocked(useDirectChat).mockReturnValue({
      ...base,
      loading: false,
      conversation: {
        id: 'conversation',
        createdAt: '2026-11-03',
        peer: { id: 'friend', displayName, username, avatarUrl: null },
      },
    });
    let tree: any;
    await act(async () => {
      tree = create(<DirectMessageScreen />);
    });
    expect(tree.root.findByType('test-header').props.name).toBe(label);
    const trigger = tree.root
      .findAllByProps({ accessibilityLabel: `Options for ${label}` })
      .find((n: any) => typeof n.props.onPress === 'function');
    expect(trigger).toBeDefined();
    await act(async () => trigger.props.onPress());
    const report = tree.root
      .findAllByType('test-item')
      .find((n: any) => n.props.label === 'Report');
    expect(report).toBeDefined();
    await act(async () => tree.unmount());
  },
);
