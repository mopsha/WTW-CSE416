import React from 'react';
import type { GroupInvitation } from '@shared/api/groupInvitations.ts';
import { GroupInvitations } from '@/components/GroupInvitations';
import { api } from '@/lib/api';
import { usePrivateRefresh } from '@/hooks/usePrivateRefresh';
const { create, act } = jest.requireActual('react-test-renderer');
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/hooks/usePrivateRefresh', () => ({ usePrivateRefresh: jest.fn() }));
jest.mock('@/lib/api', () => ({
  api: { listGroupInvitations: jest.fn(), respondGroupInvitation: jest.fn() },
}));
jest.mock('@/components', () => ({
  ...jest.requireActual('@/components/theme'),
  Card: ({ children }: { children: React.ReactNode }) => children,
  Button: (p: object) => jest.requireActual('react').createElement('test-button', p),
  ErrorState: (p: object) => jest.requireActual('react').createElement('test-error', p),
}));
const invite: GroupInvitation = {
  id: 'invite',
  groupId: 'crew',
  groupName: 'Our crew',
  inviterId: 'ava',
  inviterName: 'Ava',
  createdAt: '2026-01-01',
  inviteeId: 'me',
  inviteeName: 'Me',
  status: 'pending',
  resolvedAt: null,
};
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(api.listGroupInvitations).mockResolvedValue({ invitations: [invite] });
});
async function mount() {
  const onAccepted = jest.fn();
  let tree: any;
  await act(async () => {
    tree = create(
      <GroupInvitations variant="compact" refreshing={false} onAccepted={onAccepted} />,
    );
  });
  expect(JSON.stringify(tree.toJSON())).toContain('Loading group invitations');
  await act(async () => {
    await jest.mocked(usePrivateRefresh).mock.calls[0]![0]();
  });
  return { tree, onAccepted };
}
function button(tree: any, label: string) {
  return tree.root.findAllByType('test-button').find((n: any) => n.props.label === label);
}
test('compact invitation preserves explicit acceptance, guards duplicate taps, and refreshes parent', async () => {
  const { tree, onAccepted } = await mount();
  expect(JSON.stringify(tree.toJSON())).toContain('Ava invited you to Our crew');
  let resolve!: () => void;
  jest.mocked(api.respondGroupInvitation).mockReturnValue(
    new Promise((r) => {
      resolve = () => r({ ...invite, status: 'accepted' });
    }),
  );
  await act(async () => {
    button(tree, 'Accept').props.onPress();
    button(tree, 'Accept').props.onPress();
  });
  expect(api.respondGroupInvitation).toHaveBeenCalledTimes(1);
  expect(api.respondGroupInvitation).toHaveBeenCalledWith('invite', 'accepted');
  expect(button(tree, 'Decline').props.disabled).toBe(true);
  await act(async () => resolve());
  expect(onAccepted).toHaveBeenCalledTimes(1);
  expect(tree.toJSON()).toBeNull();
  await act(async () => tree.unmount());
});
test('failed decline retains invitation for retry, and privacy clearing removes its content', async () => {
  const { tree, onAccepted } = await mount();
  jest.mocked(api.respondGroupInvitation).mockRejectedValueOnce(new Error('Offline'));
  await act(async () => button(tree, 'Decline').props.onPress());
  expect(tree.root.findByType('test-error').props.message).toBe('Offline');
  expect(JSON.stringify(tree.toJSON())).toContain('Our crew');
  expect(onAccepted).not.toHaveBeenCalled();
  await act(async () => jest.mocked(usePrivateRefresh).mock.calls[0]![1]());
  expect(JSON.stringify(tree.toJSON())).not.toContain('Our crew');
  await act(async () => tree.unmount());
});

test('sheet presentation keeps one private loader mounted and counts only pending invitations', async () => {
  let tree: any;
  const onAccepted = jest.fn();
  const renderContainer = (open: boolean) =>
    function RequestContainer({
      count,
      content,
      loading,
    }: {
      count: number;
      content: React.ReactNode;
      loading: boolean;
    }) {
      return (
        <>
          {React.createElement('test-request-entry', { count, loading })}
          {open ? content : null}
        </>
      );
    };
  await act(async () => {
    tree = create(
      <GroupInvitations
        variant="compact"
        refreshing={false}
        onAccepted={onAccepted}
        renderContainer={renderContainer(false)}
      />,
    );
  });
  await act(async () => {
    await jest.mocked(usePrivateRefresh).mock.calls[0]![0]();
  });
  expect(tree.root.findByType('test-request-entry').props.count).toBe(1);
  expect(JSON.stringify(tree.toJSON())).not.toContain('Our crew');
  await act(async () => {
    tree.update(
      <GroupInvitations
        variant="compact"
        refreshing={false}
        onAccepted={onAccepted}
        renderContainer={renderContainer(true)}
      />,
    );
  });
  expect(api.listGroupInvitations).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(tree.toJSON())).toContain('Our crew');
  jest.mocked(api.respondGroupInvitation).mockResolvedValue({ ...invite, status: 'declined' });
  await act(async () => button(tree, 'Decline').props.onPress());
  expect(api.respondGroupInvitation).toHaveBeenCalledWith('invite', 'declined');
  expect(tree.root.findByType('test-request-entry').props.count).toBe(0);
  expect(onAccepted).not.toHaveBeenCalled();
  await act(async () => {
    await jest.mocked(usePrivateRefresh).mock.calls[0]![0]();
  });
  await act(async () => jest.mocked(usePrivateRefresh).mock.calls[0]![1]());
  expect(tree.root.findByType('test-request-entry').props.count).toBe(0);
  expect(tree.root.findByType('test-request-entry').props.loading).toBe(true);
  expect(JSON.stringify(tree.toJSON())).not.toContain('Our crew');
  await act(async () => tree.unmount());
});
