import React from 'react';
import { BackHandler, Share, Text } from 'react-native';
import GroupScreen from '../../app/groups/[id]';
import { ConversationHeader } from '@/components/ConversationHeader';
import { api } from '@/lib/api';
import { queries } from '@/lib/queries';
import { router } from 'expo-router';
import type { GroupDetail } from '@/lib/groups';
const { create, act } = jest.requireActual('react-test-renderer');
let mockParams = { id: 'group', section: undefined as string | undefined };
let mockSession = { user: { id: 'me', email: 'me@example.test' } };
let mockChatMounts = 0;
let mockFocused = true;
let mockReload: () => Promise<void>;
jest.mock('expo-router', () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: () => true,
    setParams: jest.fn(),
    dismissTo: jest.fn(),
    dismissAll: jest.fn(),
  },
  Redirect: (p: object) => jest.requireActual('react').createElement('test-redirect', p),
  Stack: {
    Screen: (p: object) => jest.requireActual('react').createElement('test-stack-options', p),
  },
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (cb: () => void) =>
    jest
      .requireActual('react')
      .useEffect(() => (mockFocused ? cb() : undefined), [cb, mockFocused]),
}));
jest.mock('@/hooks/useAuth', () => ({ useSession: () => mockSession }));
jest.mock('@/hooks/usePrivateRefresh', () => ({
  usePrivateRefresh: (load: () => Promise<void>, clear: () => void) => {
    mockReload = load;
    jest.requireActual('@/hooks/usePrivateRefresh').usePrivateRefresh(load, clear);
  },
}));
jest.mock('@/components/ConversationHeader', () => ({
  ConversationHeader: (p: object) => jest.requireActual('react').createElement('test-header', p),
}));
jest.mock('@/components/GroupChat', () => ({
  GroupChat: (p: any) => {
    const React = jest.requireActual('react');
    const [draft, setDraft] = React.useState(p.composerRef.current.body);
    const onDraft = (value: string) => {
      p.composerRef.current.body = value;
      setDraft(value);
    };
    React.useEffect(() => {
      mockChatMounts++;
    }, []);
    return React.createElement('test-chat', { ...p, draft, onDraft });
  },
}));
jest.mock('@/components/GroupIdeas', () => ({
  GroupIdeas: (p: object) => jest.requireActual('react').createElement('test-ideas', p),
}));
jest.mock('@/components/MemberMenu', () => ({
  MemberMenu: (p: object) => jest.requireActual('react').createElement('test-member-menu', p),
}));
jest.mock('@/components/TabUi', () => ({
  Segments: (p: object) => jest.requireActual('react').createElement('test-switch', p),
  ListRow: (p: object) => jest.requireActual('react').createElement('test-row', p),
}));
jest.mock('@/components', () => ({
  ...jest.requireActual('@/components/theme'),
  Screen: (p: any) => jest.requireActual('react').createElement('test-screen', p, p.children),
  Avatar: () => null,
  Card: ({ children }: any) => children,
  Button: (p: object) => jest.requireActual('react').createElement('test-button', p),
  IconButton: (p: object) => jest.requireActual('react').createElement('test-back', p),
  ErrorState: (p: object) => jest.requireActual('react').createElement('test-error', p),
  EmptyState: (p: object) => jest.requireActual('react').createElement('test-empty', p),
}));
jest.mock('@/lib/queries', () => ({ queries: { getGroup: jest.fn(), listMyFriends: jest.fn() } }));
jest.mock('@/lib/api', () => ({
  api: {
    listPendingGroupInvitations: jest.fn(),
    addGroupMembers: jest.fn(),
    renameGroup: jest.fn(),
    removeGroupMember: jest.fn(),
    deleteGroup: jest.fn(),
    leaveGroup: jest.fn(),
    createInvite: jest.fn(),
  },
}));
jest.mock('@/lib/confirm', () => ({ confirmAction: jest.fn(async () => true) }));
jest.mock('@/lib/haptics', () => ({ haptic: { success: jest.fn(), tap: jest.fn() } }));
const group: GroupDetail = {
  id: 'group',
  name: 'Weekend crew',
  ownerId: 'me',
  members: [
    { userId: 'me', displayName: 'Me', role: 'owner' },
    { userId: 'ava', displayName: 'Ava', role: 'member' },
  ],
  picks: [],
};
let tree: any;
const button = (label: string) =>
  tree.root.findAllByType('test-button').find((n: any) => n.props.label === label);
const row = (title: string) =>
  tree.root.findAllByType('test-row').find((n: any) => n.props.title === title);
const back = () => tree.root.findByType('test-back').props.onPress();
async function mount(details = false) {
  await act(async () => {
    tree = create(<GroupScreen details={details} />);
  });
}
beforeEach(() => {
  jest.clearAllMocks();
  mockChatMounts = 0;
  mockFocused = true;
  mockParams = { id: 'group', section: undefined };
  mockSession = { user: { id: 'me', email: 'me@example.test' } };
  jest.mocked(queries.getGroup).mockReset().mockResolvedValue(group);
  jest.mocked(queries.listMyFriends).mockResolvedValue([{ userId: 'ben', displayName: 'Ben' }]);
  jest.mocked(api.listPendingGroupInvitations).mockResolvedValue({ invitations: [] });
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  tree = undefined;
  jest.restoreAllMocks();
});
test('header pushes a native Details route without changing the conversation section', async () => {
  await mount();
  await act(async () => tree.root.findByType(ConversationHeader).props.onPress());
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/groups/[id]/details',
    params: { id: 'group' },
  });
  expect(tree.root.findByType('test-switch').props.value).toBe('chat');
  expect(mockChatMounts).toBe(1);
  expect(tree.root.findByType('test-header').props.group).toBe(true);
});
test('Details previews small groups with profiles, photos, owner roles and safety menus; no chat subscription', async () => {
  await mount(true);
  expect(tree.root.findAllByType('test-chat')).toHaveLength(0);
  expect(tree.root.findByType('test-stack-options').props.options.gestureEnabled).toBe(true);
  expect(tree.root.findByType('test-member-menu').props.userId).toBe('ava');
  expect(tree.root.findAllByType(Text).some((n: any) => n.props.children === 'Owner')).toBe(true);
  expect(row('Group Ideas')).toBeDefined();
  expect(row('Group plans')).toBeDefined();
  const profile = tree.root
    .findAllByProps({ accessibilityLabel: 'View Ava’s profile' })
    .find((n: any) => n.props.onPress);
  await act(async () => profile.props.onPress());
  expect(router.push).toHaveBeenCalledWith({ pathname: '/p/[id]', params: { id: 'ava' } });
});
test('large groups have a bounded preview and See all members opens the full management list', async () => {
  jest.mocked(queries.getGroup).mockResolvedValue({
    ...group,
    members: Array.from({ length: 9 }, (_, i) => ({
      userId: `member-${i}`,
      displayName: `Member ${i}`,
      role: 'member' as const,
    })),
  });
  mockSession.user.id = 'member-0';
  await mount(true);
  expect(tree.root.findAllByType('test-member-menu')).toHaveLength(4);
  await act(async () => button('See all members').props.onPress());
  expect(tree.root.findAllByType('test-member-menu')).toHaveLength(8);
  expect(tree.root.findByType('test-stack-options').props.options.gestureEnabled).toBe(false);
  await act(async () => back());
  expect(row('Group Ideas')).toBeDefined();
});
test('Ideas returns to Details; Plans dismisses to the existing group conversation', async () => {
  await mount(true);
  await act(async () => row('Group Ideas').props.onPress());
  expect(tree.root.findByType('test-ideas').props).toMatchObject({ group, userId: 'me' });
  await act(async () => back());
  await act(async () => row('Group plans').props.onPress());
  expect(router.dismissTo).toHaveBeenCalledWith({
    pathname: '/groups/[id]',
    params: { id: 'group', section: 'plans' },
  });
});
test('Details back returns to the underlying group route', async () => {
  await mount(true);
  await act(async () => back());
  expect(router.back).toHaveBeenCalledTimes(1);
});
test('legacy secondary-section links redirect to Details instead of swapping chat content', async () => {
  mockParams.section = 'members';
  await mount();
  expect(tree.root.findByType('test-redirect').props.href).toEqual({
    pathname: '/groups/[id]/details',
    params: { id: 'group', section: 'members' },
  });
});
test('owner invitations, removal, rename and invite sharing retain their contracts', async () => {
  await mount(true);
  await act(async () => row('Add members').props.onPress());
  await act(async () => button('Invite').props.onPress());
  expect(api.addGroupMembers).toHaveBeenCalledWith('group', ['ben']);
  const remove = tree.root
    .findAllByProps({ accessibilityLabel: 'Remove Ava from Weekend crew' })
    .find((n: any) => n.props.onPress);
  await act(async () => remove.props.onPress());
  expect(api.removeGroupMember).toHaveBeenCalledWith('group', 'ava');
  await act(async () => back());
  await act(async () => button('Rename group').props.onPress());
  const input = tree.root
    .findAllByProps({ accessibilityLabel: 'New group name' })
    .find((n: any) => n.props.onChangeText);
  await act(async () => input.props.onChangeText('New name'));
  await act(async () => button('Save name').props.onPress());
  expect(api.renameGroup).toHaveBeenCalledWith('group', 'New name');
  jest.mocked(api.createInvite).mockResolvedValue({ url: 'wtw://i/test' } as never);
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
  await act(async () => button('Share invite link').props.onPress());
  expect(share).toHaveBeenCalledWith({ message: 'Join Weekend crew on WTW: wtw://i/test' });
});
test('non-owner has a compact leave row and no owner actions; cancel performs no mutation', async () => {
  mockSession.user.id = 'ava';
  const { confirmAction } = jest.requireMock('@/lib/confirm');
  confirmAction.mockResolvedValueOnce(false);
  await mount(true);
  expect(button('Delete group')).toBeUndefined();
  expect(button('Rename group')).toBeUndefined();
  expect(row('Add members')).toBeUndefined();
  expect(button('See all members')).toBeUndefined();
  await act(async () => row('Leave group').props.onPress());
  expect(api.leaveGroup).not.toHaveBeenCalled();
});
test.each(['leave', 'delete'])(
  '%s dismisses the underlying group before leaving, and ignores duplicate writes',
  async (action) => {
    if (action === 'leave') mockSession.user.id = 'ava';
    let finish!: () => void;
    const write = action === 'leave' ? api.leaveGroup : api.deleteGroup;
    jest.mocked(write).mockReturnValueOnce(
      new Promise<{ status: 'ok' }>((resolve) => {
        finish = () => resolve({ status: 'ok' });
      }),
    );
    await mount(true);
    const trigger = () =>
      action === 'leave'
        ? row('Leave group').props.onPress()
        : button('Delete group').props.onPress();
    await act(async () => {
      await trigger();
      await trigger();
    });
    expect(write).toHaveBeenCalledTimes(1);
    // Polling may observe deletion before its write response.
    jest.mocked(queries.getGroup).mockResolvedValue(null);
    await act(async () => mockReload());
    await act(async () => finish());
    expect(router.dismissAll).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith('/groups');
  },
);
test.each(['account', 'group', 'blur'])(
  'stale leave cannot redirect after %s changes',
  async (change) => {
    mockSession.user.id = 'ava';
    let finish!: () => void;
    jest.mocked(api.leaveGroup).mockReturnValueOnce(
      new Promise<{ status: 'ok' }>((resolve) => {
        finish = () => resolve({ status: 'ok' });
      }),
    );
    await mount(true);
    await act(async () => row('Leave group').props.onPress());
    if (change === 'account') mockSession = { user: { id: 'next', email: 'next@test' } };
    if (change === 'group') mockParams = { id: 'next', section: undefined };
    if (change === 'blur') mockFocused = false;
    await act(async () => tree.update(<GroupScreen details />));
    await act(async () => finish());
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.dismissAll).not.toHaveBeenCalled();
  },
);
test('blur for Details/profile clears private content; focus revalidates before restoring the route-owned draft', async () => {
  await mount();
  await act(async () => tree.root.findByType('test-chat').props.onDraft('Keep this draft'));
  mockFocused = false;
  await act(async () => tree.update(<GroupScreen />));
  expect(tree.root.findAllByType('test-chat')).toHaveLength(0);
  let finish!: (value: GroupDetail) => void;
  jest.mocked(queries.getGroup).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  mockFocused = true;
  await act(async () => tree.update(<GroupScreen />));
  expect(tree.root.findAllByType('test-chat')).toHaveLength(0);
  await act(async () => finish(group));
  expect(tree.root.findByType('test-chat').props.draft).toBe('Keep this draft');
  jest.mocked(queries.getGroup).mockResolvedValue(null);
  await act(async () => mockReload());
  jest.mocked(queries.getGroup).mockResolvedValue(group);
  await act(async () => mockReload());
  expect(tree.root.findByType('test-chat').props.draft).toBe('');
});
test.each(['account', 'group'])('a draft cannot cross a changed %s', async (change) => {
  await mount();
  await act(async () => tree.root.findByType('test-chat').props.onDraft('Secret'));
  if (change === 'account') mockSession = { user: { id: 'next', email: 'next@test' } };
  else {
    mockParams.id = 'next';
    jest.mocked(queries.getGroup).mockResolvedValue({ ...group, id: 'next' });
  }
  await act(async () => tree.update(<GroupScreen />));
  expect(tree.root.findByType('test-chat').props.draft).toBe('');
});

test('Android local management back returns to Details, then delegates to native stack back', async () => {
  let hardware!: () => boolean | null | undefined;
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, fn) => {
    hardware = () => fn({} as never);
    return { remove: jest.fn() };
  });
  await mount(true);
  await act(async () => button('See all members').props.onPress());
  await act(async () => {
    expect(hardware()).toBe(true);
  });
  expect(row('Group Ideas')).toBeDefined();
  expect(hardware()).toBe(false);
});
test('failed group reads allow retry, and confirmed removal reveals no members or chat', async () => {
  jest.mocked(queries.getGroup).mockRejectedValueOnce(new Error('Offline'));
  await mount(true);
  expect(tree.root.findByType('test-error').props.message).toBe('Offline');
  jest.mocked(queries.getGroup).mockResolvedValueOnce(null);
  await act(async () => tree.root.findByType('test-error').props.onRetry());
  expect(tree.root.findByType('test-empty').props.title).toBe('Group not found');
  expect(tree.root.findAllByType('test-member-menu')).toHaveLength(0);
  expect(tree.root.findAllByType('test-chat')).toHaveLength(0);
});
