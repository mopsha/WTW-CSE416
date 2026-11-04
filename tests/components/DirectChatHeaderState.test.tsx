import React from 'react';
import DirectMessageScreen from '../../app/messages/[id]';
import { useDirectChat } from '@/hooks/useDirectChat';
const { create, act } = jest.requireActual('react-test-renderer');
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ id: 'conversation' }) }));
jest.mock('@/hooks/useAuth', () => ({ useSession: () => ({ user: { id: 'me' } }) }));
jest.mock('@/hooks/useDirectChat', () => ({ useDirectChat: jest.fn() }));
jest.mock('@/components', () => ({
  Screen: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/components/ConversationHeader', () => ({
  ConversationHeader: (p: object) => jest.requireActual('react').createElement('test-header', p),
}));
jest.mock('@/components/MessageThread', () => ({
  MessageThread: (p: object) => jest.requireActual('react').createElement('test-thread', p),
}));
jest.mock('@/lib/api', () => ({ api: { sendDirectMessage: jest.fn() } }));
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
  expect(tree.root.findByType('test-header').props.name).toBe('Ava');
  expect(tree.root.findByType('test-header').props.subtitle).toBe('@ava');
  expect(tree.root.findByType('test-thread').props.chat.unavailable).toBe(false);
  await act(async () => tree.unmount());
});
