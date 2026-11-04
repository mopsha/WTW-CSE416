import React from 'react';
import { MessageThread, type MessageThreadState } from '@/components/MessageThread';
import { api } from '@/lib/api';
import { confirmAction } from '@/lib/confirm';
type Node = { props: Record<string, any> };
type Tree = {
  root: { findAll(test: (n: Node) => boolean): Node[]; findAllByType(type: string): Node[] };
  unmount(): void;
};
const { create, act } = jest.requireActual<{
  create(element: React.ReactElement): Tree;
  act(work: () => void | Promise<void>): Promise<void>;
}>('react-test-renderer');
jest.mock('@/lib/api', () => ({ api: { report: jest.fn(), blockUser: jest.fn() } }));
jest.mock('@/lib/confirm', () => ({ confirmAction: jest.fn() }));
jest.mock('@/components/HostMenu', () => {
  const React = jest.requireActual('react');
  return {
    menuStyles: {},
    MenuItem: (props: object) => React.createElement('test-item', props),
  };
});
jest.mock('@/components/ErrorBanner', () => ({ ErrorBanner: () => null }));
jest.mock('@/components', () => {
  const React = jest.requireActual('react');
  return {
    ...jest.requireActual('@/components/theme'),
    Card: ({ children }: { children: React.ReactNode }) => children,
    Avatar: () => null,
    ErrorState: () => null,
    Button: (props: object) => React.createElement('test-button', props),
  };
});

const message = (id: string, senderId: string) => ({
  id,
  senderId,
  senderName: senderId === 'me' ? 'Me' : 'Ava',
  senderUsername: null,
  senderAvatarUrl: null,
  body: 'Hello',
  createdAt: '2026-11-04T12:00:00Z',
});
const refresh = jest.fn().mockResolvedValue(undefined);
const chat: MessageThreadState = {
  messages: [message('mine', 'me'), message('theirs', 'ava')],
  loading: false,
  error: null,
  unavailable: false,
  mode: 'polling',
  refresh,
};
const options = (tree: Tree) =>
  tree.root
    .findAll((n) => typeof n.props.onPress === 'function' && !!n.props.accessibilityHint)
    .filter((n) => n.props.accessibilityLabel?.startsWith('Options for message'));
const item = (tree: Tree, label: string) =>
  tree.root.findAllByType('test-item').find((n) => n.props.label === label)!;
async function mount(reportKind: 'group_message' | 'direct_message') {
  let tree!: Tree;
  await act(async () => {
    tree = create(
      <MessageThread
        userId="me"
        chat={chat}
        onSend={jest.fn()}
        title="Chat"
        emptyText="Empty"
        placeholder="Message"
        inputLabel="Message"
        reportKind={reportKind}
      />,
    );
  });
  return tree;
}
beforeEach(() => jest.clearAllMocks());

test.each(['group_message', 'direct_message'] as const)(
  'only other people’s messages can be reported, as %s',
  async (kind) => {
    jest.mocked(api.report).mockResolvedValue({ status: 'ok' });
    const tree = await mount(kind);
    const found = options(tree);
    expect(new Set(found.map((n) => n.props.accessibilityLabel))).toEqual(
      new Set(['Options for message from Ava']),
    );
    await act(async () => found[0]!.props.onPress());
    await act(async () => item(tree, 'Report message').props.onPress());
    await act(async () => item(tree, 'Hate speech or threats').props.onPress());
    expect(api.report).toHaveBeenCalledWith({
      kind,
      targetId: 'theirs',
      reason: 'Hate speech or threats',
    });
    expect(item(tree, 'Thanks. We’ll look into this message.')).toBeDefined();
    await act(async () => tree.unmount());
  },
);

test('blocking the sender needs confirmation, then refreshes the chat', async () => {
  jest.mocked(api.blockUser).mockResolvedValue({ status: 'ok' });
  const tree = await mount('group_message');
  await act(async () => options(tree)[0]!.props.onPress());
  jest.mocked(confirmAction).mockResolvedValueOnce(false);
  await act(async () => item(tree, 'Block Ava').props.onPress());
  expect(api.blockUser).not.toHaveBeenCalled();
  jest.mocked(confirmAction).mockResolvedValueOnce(true);
  await act(async () => item(tree, 'Block Ava').props.onPress());
  expect(api.blockUser).toHaveBeenCalledWith('ava');
  expect(refresh).toHaveBeenCalled();
  await act(async () => tree.unmount());
});
