import { ApiError } from '@shared/api/errors.ts';
import {
  parseGroupInvitationDecision,
  type GroupInvitation,
} from '@shared/api/groupInvitations.ts';
import { MOCK_USER_ID } from './auth';
import { mockFriendsList } from './friends';
import { mockBlocks } from './store';
import { mockGroupRecord, mockGroupPersonName } from './groups';

const WEEKEND = 'mock-group-weekend';
export const mockGroupInvitations = new Map<string, GroupInvitation>();
let nextId = 0;
export function resetMockGroupInvitations() {
  mockGroupInvitations.clear();
  mockGroupInvitations.set('mock-group-invite-weekend', {
    id: 'mock-group-invite-weekend',
    groupId: WEEKEND,
    inviterId: 'mock-ava',
    inviteeId: MOCK_USER_ID,
    status: 'pending',
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    groupName: 'Weekend crew',
    inviterName: 'Ava',
    inviteeName: 'You',
  });
}
const friends = (a: string, b: string) => {
  const other = a === MOCK_USER_ID ? b : b === MOCK_USER_ID ? a : null;
  return !!other && mockFriendsList().friends.some((f) => f.userId === other);
};
const available = (i: GroupInvitation) => {
  const g = mockGroupRecord(i.groupId);
  return (
    g &&
    g.ownerId === i.inviterId &&
    g.memberIds.includes(i.inviterId) &&
    friends(i.inviterId, i.inviteeId) &&
    !mockBlocks.has(i.inviterId) &&
    !mockBlocks.has(i.inviteeId)
  );
};
const notFound = () => new ApiError(404, 'INVITE_NOT_FOUND', 'Invitation not found');
function view(i: GroupInvitation): GroupInvitation {
  return {
    ...i,
    groupName: mockGroupRecord(i.groupId)!.name,
    inviterName: mockGroupPersonName(i.inviterId),
    inviteeName: mockGroupPersonName(i.inviteeId),
  };
}
export function listMockGroupInvitations(userId: string, groupId?: string) {
  if (groupId) {
    const g = mockGroupRecord(groupId);
    if (!g?.memberIds.includes(userId))
      throw new ApiError(404, 'GROUP_NOT_FOUND', 'Group not found');
    if (g.ownerId !== userId)
      throw new ApiError(403, 'FORBIDDEN', 'Only the group owner can view outgoing invitations');
  }
  return [...mockGroupInvitations.values()]
    .filter(
      (i) =>
        i.status === 'pending' &&
        (groupId ? i.groupId === groupId : i.inviteeId === userId) &&
        available(i) &&
        !mockGroupRecord(i.groupId)!.memberIds.includes(i.inviteeId),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
    .map(view);
}
export function inviteMockGroupMembers(userId: string, groupId: string, ids: string[]) {
  const g = mockGroupRecord(groupId);
  if (!g?.memberIds.includes(userId)) throw new ApiError(404, 'GROUP_NOT_FOUND', 'Group not found');
  if (g.ownerId !== userId) throw new ApiError(403, 'FORBIDDEN', 'Only the group owner can invite');
  if (!ids.every((id) => id === userId || (friends(userId, id) && !mockBlocks.has(id))))
    throw new ApiError(403, 'NOT_FRIENDS', 'You can only invite your friends');
  const fresh = [...new Set(ids)].filter((id) => !g.memberIds.includes(id));
  if (
    g.memberIds.length >= 25 &&
    fresh.some(
      (id) =>
        ![...mockGroupInvitations.values()].some(
          (i) => i.groupId === groupId && i.inviteeId === id && i.status === 'pending',
        ),
    )
  )
    throw new ApiError(409, 'GROUP_FULL', 'This group is full');
  let invited = 0;
  for (const inviteeId of fresh) {
    if (
      [...mockGroupInvitations.values()].some(
        (i) => i.groupId === groupId && i.inviteeId === inviteeId && i.status === 'pending',
      )
    )
      continue;
    const id = `mock-group-invitation-${++nextId}`;
    mockGroupInvitations.set(id, {
      id,
      groupId,
      inviterId: userId,
      inviteeId,
      status: 'pending',
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      groupName: g.name,
      inviterName: mockGroupPersonName(userId),
      inviteeName: mockGroupPersonName(inviteeId),
    });
    invited++;
  }
  return invited;
}
/** Test/demo actors share exactly the same recipient checks as the authenticated mock route. */
export function resolveMockGroupInvitation(
  userId: string,
  id: string,
  decision: 'accepted' | 'declined',
) {
  const i = mockGroupInvitations.get(id);
  if (!i || i.inviteeId !== userId || !available(i)) throw notFound();
  const g = mockGroupRecord(i.groupId)!;
  if (i.status !== 'pending') {
    if (i.status !== decision || (i.status === 'accepted' && !g.memberIds.includes(userId)))
      throw new ApiError(409, 'INVITE_RESOLVED', 'This invitation is already resolved');
    return view(i);
  }
  if (decision === 'accepted' && !g.memberIds.includes(userId)) {
    if (g.memberIds.length >= 25)
      throw new ApiError(409, 'GROUP_FULL', 'This group is full. Try again when there is room.');
    g.memberIds.push(userId);
  }
  i.status = decision;
  i.resolvedAt = new Date().toISOString();
  return view(i);
}
export function handleMockGroupInvitations(method: string, path: string, body: unknown) {
  const outgoing = /^\/groups\/([^/]+)\/invitations$/.exec(path);
  const respond = /^\/group-invitations\/([^/]+)\/respond$/.exec(path);
  if (method === 'GET' && (path === '/group-invitations' || outgoing))
    return {
      invitations: listMockGroupInvitations(
        MOCK_USER_ID,
        outgoing ? decodeURIComponent(outgoing[1]!) : undefined,
      ),
    };
  if (method === 'POST' && respond)
    return resolveMockGroupInvitation(
      MOCK_USER_ID,
      decodeURIComponent(respond[1]!),
      parseGroupInvitationDecision(body),
    );
  return null;
}

// Initialize after imports: groups/store/friends share live mock graph bindings.
resetMockGroupInvitations();
