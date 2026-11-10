import React from 'react';
import { BackHandler, Share } from 'react-native';
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
  },
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
jest.mock('@/lib/haptics', () => ({ haptic: { success: jest.fn() } }));
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
async function mount() {
  await act(async () => {
    tree = create(<GroupScreen />);
  });
}
async function details() {
  await act(async () => tree.root.findByType(ConversationHeader).props.onPress());
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
test('Chat is default and the primary switch contains only Chat and Plans', async () => {
  await mount();
  const tabs = tree.root.findByType('test-switch').props;
  expect(tabs.value).toBe('chat');
  expect(tabs.options.map((o: any) => o.label)).toEqual(['Chat', 'Plans']);
  expect(tabs.variant).toBe('underline');
  expect(tree.root.findByType('test-header').props.accessibilityLabel).toBe(
    'Group details for Weekend crew, 2 members',
  );
  await act(async () => tabs.onChange('plans'));
  expect(button('Start a Pick')).toBeDefined();
  expect(tree.root.findByType('test-empty').props.title).toBe('No group Picks yet');
  expect(router.setParams).toHaveBeenLastCalledWith({ section: 'plans' });
});
test('Details opens Ideas and Members, back returns through Details to the selected primary view without remounting chat', async () => {
  await mount();
  await act(async () => tree.root.findByType('test-chat').props.onDraft('Keep this draft'));
  await act(async () => tree.root.findByType('test-switch').props.onChange('plans'));
  await details();
  expect(row('Group Ideas')).toBeDefined();
  expect(row('Members')).toBeDefined();
  expect(tree.root.findByType('test-stack-options').props.options.gestureEnabled).toBe(false);
  await act(async () => row('Group Ideas').props.onPress());
  expect(tree.root.findByType('test-ideas').props).toMatchObject({ group, userId: 'me' });
  await act(async () => back());
  await act(async () => row('Members').props.onPress());
  expect(tree.root.findByType('test-member-menu').props.userId).toBe('ava');
  await act(async () => back());
  await act(async () => back());
  expect(tree.root.findByType('test-switch').props.value).toBe('plans');
  expect(tree.root.findByType('test-chat').props.draft).toBe('Keep this draft');
  expect(mockChatMounts).toBe(1);
  expect(queries.getGroup).toHaveBeenCalledTimes(1);
});
test('Android back follows Members → Details → Chat', async () => {
  let hardware!: () => boolean | null | undefined;
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, fn) => {
    hardware = () => fn({} as never);
    return { remove: jest.fn() };
  });
  mockParams.section = 'members';
  await mount();
  await act(async () => {
    expect(hardware()).toBe(true);
  });
  expect(row('Group Ideas')).toBeDefined();
  await act(async () => {
    expect(hardware()).toBe(true);
  });
  expect(tree.root.findByType('test-switch').props.value).toBe('chat');
  expect(hardware()).toBe(false);
});
test('owner can invite, remove members, rename and share an actual supported invite link', async () => {
  await mount();
  await details();
  expect(button('Rename group')).toBeDefined();
  expect(button('Delete group')).toBeDefined();
  await act(async () => row('Add members').props.onPress());
  await act(async () => button('Invite').props.onPress());
  expect(api.addGroupMembers).toHaveBeenCalledWith('group', ['ben']);
  const remove = tree.root
    .findAllByProps({ accessibilityLabel: 'Remove Ava from Weekend crew' })
    .find((n: any) => n.props.onPress);
  await act(async () => remove.props.onPress());
  expect(api.removeGroupMember).toHaveBeenCalledWith('group', 'ava');
  const profile = tree.root
    .findAllByProps({ accessibilityLabel: 'View Ava’s profile' })
    .find((n: any) => n.props.onPress);
  await act(async () => profile.props.onPress());
  expect(router.push).toHaveBeenCalledWith({ pathname: '/p/[id]', params: { id: 'ava' } });
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
  expect(api.createInvite).toHaveBeenCalledWith({ kind: 'group', targetId: 'group' });
  expect(share).toHaveBeenCalledWith({ message: 'Join Weekend crew on WTW: wtw://i/test' });
});
test('ordinary members can leave but cannot see owner management actions', async () => {
  mockSession.user.id = 'ava';
  await mount();
  await details();
  expect(row('Add members')).toBeUndefined();
  expect(button('Rename group')).toBeUndefined();
  expect(button('Delete group')).toBeUndefined();
  expect(button('Share invite link')).toBeUndefined();
  await act(async () => button('Leave group').props.onPress());
  expect(api.leaveGroup).toHaveBeenCalledWith('group');
  expect(router.replace).toHaveBeenCalledWith('/groups');
});
test('failed reads retry and deleted/removed groups expose neither chat nor details', async () => {
  jest.mocked(queries.getGroup).mockRejectedValueOnce(new Error('Offline'));
  await mount();
  expect(tree.root.findByType('test-error').props.message).toBe('Offline');
  jest.mocked(queries.getGroup).mockResolvedValueOnce(null);
  await act(async () => tree.root.findByType('test-error').props.onRetry());
  expect(tree.root.findByType('test-empty').props.title).toBe('Group not found');
  expect(tree.root.findAllByType('test-chat')).toHaveLength(0);
});
test('account changes reset section and draft, and ignore the old account read', async () => {
  let finish!: (g: GroupDetail) => void;
  jest.mocked(queries.getGroup).mockReturnValueOnce(
    new Promise((r) => {
      finish = r;
    }),
  );
  await mount();
  mockSession = { user: { id: 'next', email: 'next@example.test' } };
  jest.mocked(queries.getGroup).mockResolvedValue({
    ...group,
    name: 'Next account group',
    ownerId: 'next',
    members: [{ userId: 'next', displayName: 'Next', role: 'owner' }],
  });
  await act(async () => tree.update(<GroupScreen />));
  await act(async () => finish(group));
  expect(JSON.stringify(tree.toJSON())).not.toContain('Weekend crew');
  expect(tree.root.findByType('test-chat').props.userId).toBe('next');
});

test('an old account invite response cannot open the share sheet after account switching', async () => {
  let finish!: (result: Awaited<ReturnType<typeof api.createInvite>>) => void;
  jest.mocked(api.createInvite).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
  await mount();
  await details();
  await act(async () => button('Share invite link').props.onPress());
  mockSession = { user: { id: 'next', email: 'next@example.test' } };
  await act(async () => tree.update(<GroupScreen />));
  await act(async () => finish({ url: 'wtw://i/old-account-link' } as never));
  expect(share).not.toHaveBeenCalled();
});
test('owner deletion is still supported and repeated confirmations do not duplicate the write', async () => {
  jest.mocked(api.deleteGroup).mockResolvedValue({ status: 'ok' });
  await mount();
  await details();
  await act(async () => {
    const remove = button('Delete group').props.onPress;
    await Promise.all([remove(), remove()]);
  });
  expect(api.deleteGroup).toHaveBeenCalledTimes(1);
  expect(router.replace).toHaveBeenCalledWith('/groups');
});

test('a notification section update returns an already-open group to Chat without losing its draft', async () => {
  await mount();
  await act(async () => tree.root.findByType('test-chat').props.onDraft('Still here'));
  await details();
  mockParams.section = 'chat';
  await act(async () => tree.update(<GroupScreen />));
  expect(tree.root.findByType('test-switch').props.value).toBe('chat');
  expect(tree.root.findByType('test-chat').props.draft).toBe('Still here');
  expect(mockChatMounts).toBe(1);
});
test('changing the selected group resets group-scoped drafts and details', async () => {
  await mount();
  await act(async () => tree.root.findByType('test-chat').props.onDraft('Old group draft'));
  await details();
  mockParams = { id: 'next-group', section: undefined };
  jest
    .mocked(queries.getGroup)
    .mockResolvedValue({ ...group, id: 'next-group', name: 'New group' });
  await act(async () => tree.update(<GroupScreen />));
  expect(tree.root.findByType('test-switch').props.value).toBe('chat');
  expect(tree.root.findByType('test-chat').props.draft).toBe('');
  expect(tree.root.findByType('test-chat').props.groupId).toBe('next-group');
  expect(JSON.stringify(tree.toJSON())).not.toContain('Weekend crew');
});

test.each(['leave', 'delete'])(
  '%s redirects exactly once when polling observes removal before the response',
  async (action) => {
    if (action === 'leave') mockSession.user.id = 'ava';
    let finish!: (value: any) => void;
    const write = action === 'leave' ? api.leaveGroup : api.deleteGroup;
    jest.mocked(write).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await mount();
    await details();
    await act(async () =>
      button(action === 'leave' ? 'Leave group' : 'Delete group').props.onPress(),
    );
    jest.mocked(queries.getGroup).mockResolvedValue(null);
    await act(async () => mockReload());
    expect(tree.root.findAllByType('test-chat')).toHaveLength(0);
    await act(async () => finish({ status: 'ok' }));
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith('/groups');
  },
);
test.each(['account', 'group', 'blur'])(
  'pending leave cannot redirect after %s changes',
  async (change) => {
    mockSession.user.id = 'ava';
    let finish!: (value: any) => void;
    jest.mocked(api.leaveGroup).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await mount();
    await details();
    await act(async () => button('Leave group').props.onPress());
    if (change === 'account') mockSession = { user: { id: 'next', email: 'next@test' } };
    if (change === 'group') mockParams = { id: 'next', section: undefined };
    if (change === 'blur') mockFocused = false;
    await act(async () => tree.update(<GroupScreen />));
    await act(async () => finish({ status: 'ok' }));
    expect(router.replace).not.toHaveBeenCalled();
  },
);
test('profile round-trip clears history view and revalidates access before restoring scoped draft', async () => {
  await mount();
  await act(async () => tree.root.findByType('test-chat').props.onDraft('Private draft'));
  await details();
  await act(async () => row('Members').props.onPress());
  await act(async () =>
    tree.root
      .findAllByProps({ accessibilityLabel: 'View Ava’s profile' })
      .find((n: any) => n.props.onPress)
      .props.onPress(),
  );
  mockFocused = false;
  await act(async () => tree.update(<GroupScreen />));
  expect(tree.root.findAllByType('test-chat')).toHaveLength(0);
  let finish!: (g: GroupDetail) => void;
  jest.mocked(queries.getGroup).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  mockFocused = true;
  await act(async () => tree.update(<GroupScreen />));
  expect(tree.root.findAllByType('test-chat')).toHaveLength(0);
  await act(async () => finish(group));
  expect(tree.root.findByType('test-chat').props.draft).toBe('Private draft');
  jest.mocked(queries.getGroup).mockResolvedValue(null);
  await act(async () => mockReload());
  jest.mocked(queries.getGroup).mockResolvedValue(group);
  await act(async () => mockReload());
  expect(tree.root.findByType('test-chat').props.draft).toBe('');
});
test('a populated draft cannot cross an account switch', async () => {
  await mount();
  await act(async () => tree.root.findByType('test-chat').props.onDraft('Secret'));
  mockSession = { user: { id: 'next', email: 'next@test' } };
  await act(async () => tree.update(<GroupScreen />));
  expect(tree.root.findByType('test-chat').props.draft).toBe('');
});
