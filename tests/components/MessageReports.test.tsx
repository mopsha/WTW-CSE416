import { useAvatarPhoto, usePhotoCapabilities } from '@/hooks/useAvatarSource';
import { MemberMenu } from '@/components/MemberMenu';
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
jest.mock('@/hooks/useAvatarSource', () => ({
  useAvatarPhoto: jest.fn((ref) => ({
    displayKey: undefined,
    displayed: !!ref,
    onDisplay: () => {},
    uri: ref ? 'data:image/jpeg;base64,photo' : null,
    ref: ref ?? null,
  })),
  usePhotoCapabilities: jest.fn(() => ({
    uploadsEnabled: true,
    reportsEnabled: true,
    refresh: async () => {},
  })),
}));
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
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useAvatarPhoto).mockImplementation((ref) => ({
    displayKey: undefined,
    displayed: !!ref,
    onDisplay: () => {},
    uri: ref ? 'data:image/jpeg;base64,photo' : null,
    ref: ref ?? null,
  }));
  jest
    .mocked(usePhotoCapabilities)
    .mockReturnValue({ uploadsEnabled: true, reportsEnabled: true, refresh: async () => {} });
});

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

test('profile photo reports pin displayed revision, handle errors, and close without changing block/report actions', async () => {
  let tree!: Tree;
  await act(async () => {
    tree = create(<MemberMenu userId="ava" name="@ava" photo={{ userId: 'ava', revision: 7 }} />);
  });
  const open = tree.root.findAll(
    (n) =>
      n.props.accessibilityLabel === 'Options for @ava' && typeof n.props.onPress === 'function',
  )[0]!;
  await act(async () => open.props.onPress());
  expect(item(tree, 'Report')).toBeDefined();
  expect(item(tree, 'Block')).toBeDefined();
  await act(async () => item(tree, 'Report profile photo').props.onPress());
  jest.mocked(api.report).mockRejectedValueOnce(new Error('Photo changed'));
  await act(async () => item(tree, 'Spam').props.onPress());
  expect(api.report).toHaveBeenLastCalledWith({
    kind: 'profile_photo',
    targetId: 'ava',
    photoRevision: 7,
    reason: 'Spam',
  });
  expect(item(tree, 'Spam')).toBeDefined(); // Failed submission stays retryable.
  jest.mocked(api.report).mockResolvedValueOnce({ status: 'ok' });
  await act(async () => item(tree, 'Spam').props.onPress());
  expect(item(tree, 'Thanks. We’ll look into this photo.')).toBeDefined();
  await act(async () => item(tree, 'Thanks. We’ll look into this photo.').props.onPress());
  await act(async () => tree.unmount());
});

test('missing/revoked photos expose no photo action and cancellation submits nothing', async () => {
  let tree!: Tree;
  await act(async () => {
    tree = create(<MemberMenu userId="ava" name="Ava" />);
  });
  const open = tree.root.findAll(
    (n) =>
      n.props.accessibilityLabel === 'Options for Ava' && typeof n.props.onPress === 'function',
  )[0]!;
  await act(async () => open.props.onPress());
  expect(
    tree.root.findAllByType('test-item').some((n) => n.props.label === 'Report profile photo'),
  ).toBe(false);
  const close = tree.root.findAll(
    (n) => n.props.accessibilityLabel === 'Close options' && typeof n.props.onPress === 'function',
  )[0]!;
  await act(async () => close.props.onPress());
  expect(api.report).not.toHaveBeenCalled();
  await act(async () => tree.unmount());
});

test('expired report error stays visible and never shows the actionable-report success message', async () => {
  let tree!: Tree;
  await act(async () => {
    tree = create(<MemberMenu userId="ava" name="Ava" photo={{ userId: 'ava', revision: 7 }} />);
  });
  const open = tree.root.findAll(
    (n) =>
      n.props.accessibilityLabel === 'Options for Ava' && typeof n.props.onPress === 'function',
  )[0]!;
  await act(async () => open.props.onPress());
  await act(async () => item(tree, 'Report profile photo').props.onPress());
  const message =
    'The earlier report for this photo has expired. A new report was not submitted. Contact support for further review.';
  jest.mocked(api.report).mockRejectedValueOnce(new Error(message));
  await act(async () => item(tree, 'Spam').props.onPress());
  expect(
    tree.root
      .findAllByType('test-item')
      .some((n) => n.props.label === 'Thanks. We’ll look into this photo.'),
  ).toBe(false);
  expect(tree.root.findAll((n) => n.props.message === message).length).toBeGreaterThan(0);
  await act(async () => tree.unmount());
});

test('group/Pick/chat menus derive an authorized displayed photo without loading a friends-only profile', async () => {
  jest.mocked(useAvatarPhoto).mockReturnValue({
    displayKey: undefined,
    displayed: true,
    onDisplay: () => {},
    uri: 'data:image/jpeg;base64,photo',
    ref: { userId: 'group-peer', revision: 9 },
  });
  let tree!: Tree;
  await act(async () => {
    tree = create(<MemberMenu userId="group-peer" name="Group peer" />);
  });
  const trigger = tree.root.findAll(
    (n) =>
      n.props.accessibilityLabel === 'Options for Group peer' &&
      typeof n.props.onPress === 'function',
  )[0]!;
  await act(async () => trigger.props.onPress());
  expect(useAvatarPhoto).toHaveBeenCalledWith(undefined, 'group-peer');
  await act(async () => item(tree, 'Report profile photo').props.onPress());
  jest.mocked(api.report).mockResolvedValueOnce({ status: 'ok' });
  await act(async () => item(tree, 'Spam').props.onPress());
  expect(api.report).toHaveBeenCalledWith({
    kind: 'profile_photo',
    targetId: 'group-peer',
    photoRevision: 9,
    reason: 'Spam',
  });
  await act(async () => tree.unmount());
});
test('generic name/photo complaints stay user reports and never imply photo evidence', async () => {
  let tree!: Tree;
  await act(async () => {
    tree = create(<MemberMenu userId="ava" name="Ava" />);
  });
  await act(async () =>
    tree.root
      .findAll(
        (n) =>
          n.props.accessibilityLabel === 'Options for Ava' && typeof n.props.onPress === 'function',
      )[0]!
      .props.onPress(),
  );
  await act(async () => item(tree, 'Report').props.onPress());
  expect(
    tree.root.findAllByType('test-item').some((n) => n.props.label === 'Offensive name or picture'),
  ).toBe(false);
  jest.mocked(api.report).mockResolvedValueOnce({ status: 'ok' });
  await act(async () => item(tree, 'Offensive name or profile picture').props.onPress());
  expect(api.report).toHaveBeenCalledWith({
    kind: 'user',
    targetId: 'ava',
    reason: 'Offensive name or profile picture',
  });
  await act(async () => tree.unmount());
});
test('server-disabled capabilities hide photo action while ordinary reporting stays usable', async () => {
  jest.mocked(useAvatarPhoto).mockReturnValue({
    displayKey: undefined,
    displayed: true,
    onDisplay: () => {},
    uri: 'data:image/jpeg;base64,photo',
    ref: { userId: 'ava', revision: 7 },
  });
  jest
    .mocked(usePhotoCapabilities)
    .mockReturnValue({ uploadsEnabled: false, reportsEnabled: false, refresh: async () => {} });
  let tree!: Tree;
  await act(async () => {
    tree = create(<MemberMenu userId="ava" name="Ava" />);
  });
  await act(async () =>
    tree.root
      .findAll(
        (n) =>
          n.props.accessibilityLabel === 'Options for Ava' && typeof n.props.onPress === 'function',
      )[0]!
      .props.onPress(),
  );
  expect(item(tree, 'Report')).toBeDefined();
  expect(
    tree.root.findAllByType('test-item').some((n) => n.props.label === 'Report profile photo'),
  ).toBe(false);
  await act(async () => tree.unmount());
});

test(
  'a user menu without a reportable photo still permits a generic complaint',
  async () => {
    jest.mocked(useAvatarPhoto).mockReturnValue({
      uri: null,
      ref: null,
      displayKey: undefined,
      displayed: false,
      onDisplay: () => {},
    });
    let tree!: Tree;
    await act(async () => {
      tree = create(<MemberMenu userId="ava" name="Ava" />);
    });
    await act(async () =>
      tree.root
        .findAll(
          (n) =>
            n.props.accessibilityLabel === 'Options for Ava' &&
            typeof n.props.onPress === 'function',
        )[0]!
        .props.onPress(),
    );
    expect(
      tree.root.findAllByType('test-item').some((n) => n.props.label === 'Report profile photo'),
    ).toBe(false);
    await act(async () => item(tree, 'Report').props.onPress());
    jest.mocked(api.report).mockResolvedValueOnce({ status: 'ok' });
    await act(async () => item(tree, 'Offensive name or profile picture').props.onPress());
    expect(api.report).toHaveBeenCalledWith({
      kind: 'user',
      targetId: 'ava',
      reason: 'Offensive name or profile picture',
    });
    await act(async () => tree.unmount());
  },
);
