// Groups for mock mode: the same routes, rules, shapes and error codes as the API's /groups
// (supabase/functions/_shared/api/groups.ts + 0012_groups.sql), in memory. Ava, Ben and Cam
// (the Pick-demo bots, same ids as the mock Friends list in PR #24) are my friends. I own
// "Roommates" (Ava, Ben) and am a member of Ava's "Climbing crew", so Leave can be shown.
import type { CreatePickInput } from '@shared/domain/createPick.ts';
import { parseGroupName, parseId, parseUserIds } from '@shared/api/groups.ts';

import { FRIENDS } from '@/components/theme';
import type { FriendOption, GroupDetail, GroupSummary } from '../groups';
import { sortMembers } from '../groups';
import { MOCK_USER_ID } from './auth';
import { OTHER_PARTICIPANT_ANSWERS } from './fixtures';
import { createMockPick, emit, mockBlocks, mockPicks, summaryOf } from './store';
import { mockFriendsList } from './friends';

const FRIEND_IDS = FRIENDS.map((f) => `mock-${f.name.toLowerCase()}`);
const NAMES = new Map<string, string>([
  [MOCK_USER_ID, 'You'],
  ...FRIENDS.map((f, i) => [FRIEND_IDS[i]!, f.name] as [string, string]),
]);
const MAX_MEMBERS = 25;

interface MockGroup {
  id: string;
  name: string;
  ownerId: string;
  /** In join order; the owner first. */
  memberIds: string[];
}

function initial(): Map<string, MockGroup> {
  return new Map([
    [
      'mock-group-roommates',
      {
        id: 'mock-group-roommates',
        name: 'Roommates',
        ownerId: MOCK_USER_ID,
        memberIds: [MOCK_USER_ID, FRIEND_IDS[0]!, FRIEND_IDS[1]!],
      },
    ],
    [
      'mock-group-climbing',
      {
        id: 'mock-group-climbing',
        name: 'Climbing crew',
        ownerId: FRIEND_IDS[0]!,
        memberIds: [FRIEND_IDS[0]!, MOCK_USER_ID, FRIEND_IDS[2]!],
      },
    ],
  ]);
}

let groups = initial();
/** picks.group_id in mock form. */
const pickGroup = new Map<string, string>();
let nextId = 1;

/** The group a mock Pick was made for, if any (picks.group_id). */
export const mockGroupOfPick = (pickId: string): string | null => pickGroup.get(pickId) ?? null;

export function resetMockGroups() {
  groups = initial();
  pickGroup.clear();
}

// ---------------------------------------------------------------- reads (RLS: members only)
const mine = (id: string) => {
  const g = groups.get(id);
  return g?.memberIds.includes(MOCK_USER_ID) ? g : undefined;
};

export function mockListGroups(): GroupSummary[] {
  return [...groups.values()]
    .filter((g) => g.memberIds.includes(MOCK_USER_ID))
    .map((g) => ({
      id: g.id,
      name: g.name,
      ownerId: g.ownerId,
      isOwner: g.ownerId === MOCK_USER_ID,
      memberCount: g.memberIds.length,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function mockGetGroup(id: string): GroupDetail | null {
  const g = mine(id);
  if (!g) return null;
  return {
    id: g.id,
    name: g.name,
    ownerId: g.ownerId,
    members: sortMembers(
      g.memberIds.map((userId) => ({
        userId,
        displayName: NAMES.get(userId) ?? null,
        role: userId === g.ownerId ? ('owner' as const) : ('member' as const),
      })),
    ),
    picks: [...mockPicks.values()]
      .filter(
        (p) => pickGroup.get(p.id) === id && p.participants.some((x) => x.userId === MOCK_USER_ID),
      )
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(summaryOf),
  };
}

export function mockListFriends(): FriendOption[] {
  return mockFriendsList().friends.map(({ userId, displayName }) => ({ userId, displayName }));
}

// ---------------------------------------------------------------- writes (the API's rules)
type Result = { status: number; body: unknown };
const ok = (body: unknown, status = 200): Result => ({ status, body });
const fail = (status: number, code: string, message: string): Result => ({
  status,
  body: { error: { code, message } },
});
const notFound = () => fail(404, 'GROUP_NOT_FOUND', 'Group not found');
const notFriends = () => fail(403, 'NOT_FRIENDS', 'You can only add your friends');

/** Mock ids aren't UUIDs; check shape the same way the API does, on a stand-in. */
const STAND_IN = '00000000-0000-4000-8000-000000000000';
function validIds(body: unknown): string[] | Result {
  const ids = (body as { userIds?: unknown } | null)?.userIds;
  try {
    parseUserIds({
      userIds: Array.isArray(ids) ? ids.map((x) => (typeof x === 'string' ? STAND_IN : x)) : ids,
    });
  } catch (e) {
    return fail(400, 'INVALID_INPUT', (e as Error).message);
  }
  return [...new Set(ids as string[])];
}

function validName(body: unknown): string | Result {
  try {
    return parseGroupName(body);
  } catch (e) {
    return fail(400, 'INVALID_INPUT', (e as Error).message);
  }
}

const isFriend = (id: string) =>
  id === MOCK_USER_ID || mockListFriends().some((friend) => friend.userId === id);

/** /groups and /groups/:id/... Returns null for any other path. */
export function handleMockGroups(method: string, path: string, body: unknown): Result | null {
  if (method !== 'POST' || !path.startsWith('/groups')) return null;
  if (path === '/groups') {
    const name = validName(body);
    if (typeof name !== 'string') return name;
    const id = `mock-group-${nextId++}`;
    groups.set(id, { id, name, ownerId: MOCK_USER_ID, memberIds: [MOCK_USER_ID] });
    return ok({ id, name, ownerId: MOCK_USER_ID }, 201);
  }
  const m = /^\/groups\/([^/]+)\/(rename|delete|members|leave)(?:\/([^/]+)\/remove)?$/.exec(path);
  if (!m) return fail(404, 'NOT_FOUND', 'Route not found');
  const [, rawId, action, memberId] = m;
  const g = mine(decodeURIComponent(rawId!));
  if (!g) return notFound();
  const owner = g.ownerId === MOCK_USER_ID;
  const ownerOnly = () => fail(403, 'FORBIDDEN', 'Only the group owner can do this');

  if (action === 'leave') {
    if (owner)
      return fail(409, 'OWNER_CANNOT_LEAVE', 'The owner cannot leave; delete the group instead');
    g.memberIds = g.memberIds.filter((id) => id !== MOCK_USER_ID);
    return ok({ status: 'ok' });
  }
  if (!owner) return ownerOnly();
  if (action === 'rename') {
    const name = validName(body);
    if (typeof name !== 'string') return name;
    g.name = name;
    return ok({ status: 'ok' });
  }
  if (action === 'delete') {
    groups.delete(g.id);
    for (const [pickId, groupId] of pickGroup) if (groupId === g.id) pickGroup.delete(pickId);
    return ok({ status: 'ok' });
  }
  if (memberId !== undefined) {
    const who = decodeURIComponent(memberId);
    if (who === g.ownerId) {
      return fail(
        409,
        'OWNER_CANNOT_LEAVE',
        'The owner cannot be removed; delete the group instead',
      );
    }
    g.memberIds = g.memberIds.filter((id) => id !== who);
    return ok({ status: 'ok' });
  }
  const ids = validIds(body);
  if (!Array.isArray(ids)) return ids;
  if (!ids.every(isFriend)) return notFriends();
  const fresh = ids.filter((id) => !g.memberIds.includes(id));
  if (g.memberIds.length + fresh.length > MAX_MEMBERS) {
    return fail(409, 'GROUP_FULL', `A group can have up to ${MAX_MEMBERS} people`);
  }
  g.memberIds.push(...fresh);
  return ok({ added: fresh.length });
}

function participant(userId: string) {
  const i = FRIEND_IDS.indexOf(userId);
  return {
    userId,
    name: NAMES.get(userId) ?? 'WTW friend',
    answers: new Map(),
    vote: null,
    script: OTHER_PARTICIPANT_ANSWERS[i],
  };
}

/** Repeat using today's group, while keeping the original Pick's membership intact. */
export function mockCopyGroupMembers(sourceId: string, targetId: string): boolean {
  const groupId = pickGroup.get(sourceId);
  if (!groupId) return false;
  const group = mine(groupId);
  const target = mockPicks.get(targetId)!;
  if (group) {
    target.participants.push(
      ...group.memberIds
        .filter((id) => id !== MOCK_USER_ID && !mockBlocks.has(id))
        .map(participant),
    );
    pickGroup.set(targetId, groupId);
  }
  return true;
}

/**
 * POST /picks with { groupId }: a draft with everyone in the group now. The draft-state
 * demo bots aren't scheduled, so only the group's members are in it.
 */
export function mockCreateGroupPick(input: CreatePickInput, groupId: unknown): Result {
  try {
    parseId(typeof groupId === 'string' ? STAND_IN : groupId, 'group id');
  } catch (e) {
    return fail(400, 'INVALID_INPUT', (e as Error).message);
  }
  const g = mine(groupId as string);
  if (!g) return notFound();
  const pick = createMockPick(input);
  const others = g.memberIds.filter((id) => id !== MOCK_USER_ID && !mockBlocks.has(id));
  pick.participants.push(...others.map(participant));
  pickGroup.set(pick.id, g.id);
  return ok({ pickId: pick.id, state: 'draft', groupId: g.id, added: others.length }, 201);
}

/** POST /picks/:id/invite: host only, friends only, draft or swiping. */
export function mockInvite(pickId: string, body: unknown): Result {
  const pick = mockPicks.get(pickId);
  if (!pick || !pick.participants.some((p) => p.userId === MOCK_USER_ID)) {
    return fail(404, 'PICK_NOT_FOUND', 'Pick not found');
  }
  if (pick.hostId !== MOCK_USER_ID) return fail(403, 'FORBIDDEN', 'Only the host can do this');
  if (pick.state !== 'draft' && pick.state !== 'swiping') {
    return fail(409, 'PICK_CLOSED', 'This Pick is no longer accepting people');
  }
  const ids = validIds(body);
  if (!Array.isArray(ids)) return ids;
  if (!ids.every(isFriend)) return notFriends();
  const fresh = ids.filter((id) => !pick.participants.some((p) => p.userId === id));
  if (pick.participants.length + fresh.length > 30) {
    return fail(409, 'PICK_FULL', 'This Pick is full');
  }
  pick.participants.push(...fresh.map(participant));
  emit(pick.id);
  return ok({ added: fresh.length });
}
