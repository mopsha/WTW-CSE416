import React from 'react';
import { MessageFriendButton } from '@/components/MessageFriendButton';
import { api } from '@/lib/api';
import { router } from 'expo-router';
type Tree = {
  root: { findAllByType(t: string): { props: { onPress(): void; message?: string } }[] };
  unmount(): void;
};
const { create, act } = jest.requireActual<{
  create(e: React.ReactElement): Tree;
  act(work: () => void | Promise<void>): Promise<void>;
}>('react-test-renderer');
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/lib/api', () => ({ api: { openDirectConversation: jest.fn() } }));
jest.mock('@/lib/haptics', () => ({ haptic: { error: jest.fn() } }));
jest.mock('@/components', () => {
  const React = jest.requireActual('react');
  return {
    Button: (p: object) => React.createElement('test-button', p),
    ErrorState: (p: object) => React.createElement('test-error', p),
  };
});
test('opens the canonical conversation once across duplicate taps; denied eligibility shows an error and does not navigate', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof api.openDirectConversation>>) => void;
  jest.mocked(api.openDirectConversation).mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  let tree!: Tree;
  await act(async () => {
    tree = create(<MessageFriendButton userId="friend" />);
  });
  await act(async () => {
    const button = tree.root.findAllByType('test-button')[0]!;
    button.props.onPress();
    button.props.onPress();
  });
  expect(api.openDirectConversation).toHaveBeenCalledTimes(1);
  await act(async () =>
    resolve({ id: 'conversation-1' } as Awaited<ReturnType<typeof api.openDirectConversation>>),
  );
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/messages/[id]',
    params: { id: 'conversation-1' },
  });
  jest.mocked(router.push).mockClear();
  jest.mocked(api.openDirectConversation).mockRejectedValue(new Error('Conversation unavailable'));
  await act(async () => tree.root.findAllByType('test-button')[0]!.props.onPress());
  expect(router.push).not.toHaveBeenCalled();
  expect(tree.root.findAllByType('test-error')[0]!.props.message).toBe('Conversation unavailable');
  await act(async () => tree.unmount());
});
