// Groups (Razin, M4). Reusable groups for repeat Picks (0012_groups.sql):
//   POST /groups                           { name } -> 201 { id, name, ownerId }
//   POST /groups/:id/rename                { name } -> { status: 'ok' }        (owner)
//   POST /groups/:id/delete                         -> { status: 'ok' }        (owner)
//   POST /groups/:id/members               { userIds } -> { added }           (owner; friends only)
//   POST /groups/:id/members/:userId/remove         -> { status: 'ok' }        (owner)
//   POST /groups/:id/leave                          -> { status: 'ok' }        (anyone but the owner)
//   POST /picks                            { ...createPick, groupId? } -> 201 { pickId, state, groupId, added }
//   POST /picks/:id/invite                 { userIds } -> { added }           (host; friends only)
// Reads go through RLS (members only). The RPCs enforce who may do what
// atomically; this layer validates input and composes POST /picks.

import { ApiError } from './errors.ts';
import { createPick, parseCreatePick, type LifecycleStore } from './lifecycle.ts';

export const MAX_GROUP_NAME = 50;
/** Most people one request can add; the database caps a group at 25. */
export const MAX_IDS_PER_REQUEST = 25;

export interface GroupSummary {
  id: string;
  name: string;
  ownerId: string;
}

/** Database adapter. Non-members get 404, non-owners/hosts 403, non-friends 403 NOT_FRIENDS. */
export interface GroupsStore {
  create(userId: string, name: string): Promise<GroupSummary>;
  rename(userId: string, groupId: string, name: string): Promise<void>;
  delete(userId: string, groupId: string): Promise<void>;
  addMembers(userId: string, groupId: string, userIds: string[]): Promise<number>;
  removeMember(userId: string, groupId: string, memberId: string): Promise<void>;
  leave(userId: string, groupId: string): Promise<void>;
  /** Cheap pre-check for POST /picks; pick_add_group rechecks under lock. */
  isMember(groupId: string, userId: string): Promise<boolean>;
  /** Adds everyone in the group now to a draft Pick the user hosts. Returns how many. */
  addGroupToPick(pickId: string, userId: string, groupId: string): Promise<number>;
  /** Adds friends to a draft/swiping Pick the user hosts. Returns how many. */
  invite(pickId: string, userId: string, userIds: string[]): Promise<number>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hasControl = (s: string) =>
  [...s].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f);

function object(body: unknown, what: string): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ApiError(400, 'INVALID_INPUT', `Expected ${what}`);
  }
  return body as Record<string, unknown>;
}

export function parseId(id: unknown, what = 'id'): string {
  if (typeof id !== 'string' || !UUID.test(id)) {
    throw new ApiError(400, 'INVALID_INPUT', `Expected a ${what}`);
  }
  return id.toLowerCase();
}

/** Trimmed, 1–50 characters (counted like Postgres char_length), no control characters. */
export function parseGroupName(body: unknown): string {
  const { name } = object(body, 'an object with a name');
  const trimmed = typeof name === 'string' ? name.trim() : '';
  const length = [...trimmed].length;
  if (length < 1 || length > MAX_GROUP_NAME || hasControl(trimmed)) {
    throw new ApiError(400, 'INVALID_INPUT', `Group names are 1 to ${MAX_GROUP_NAME} characters`);
  }
  return trimmed;
}

/** { userIds: [uuid, ...] }: 1–25 ids, duplicates removed. */
export function parseUserIds(body: unknown): string[] {
  const { userIds } = object(body, 'an object with userIds');
  if (!Array.isArray(userIds) || userIds.length < 1 || userIds.length > MAX_IDS_PER_REQUEST) {
    throw new ApiError(
      400,
      'INVALID_INPUT',
      `userIds must list 1 to ${MAX_IDS_PER_REQUEST} people`,
    );
  }
  return [...new Set(userIds.map((id) => parseId(id, 'user id')))];
}

/** The optional groupId on POST /picks; undefined/null means an ordinary Pick. */
export function parseOptionalGroupId(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const { groupId } = body as Record<string, unknown>;
  if (groupId === undefined || groupId === null) return null;
  return parseId(groupId, 'group id');
}

export function createGroup(store: GroupsStore, userId: string, body: unknown) {
  return store.create(userId, parseGroupName(body));
}

export async function renameGroup(
  store: GroupsStore,
  userId: string,
  groupId: string,
  body: unknown,
) {
  await store.rename(userId, parseId(groupId, 'group id'), parseGroupName(body));
  return { status: 'ok' as const };
}

export async function deleteGroup(store: GroupsStore, userId: string, groupId: string) {
  await store.delete(userId, parseId(groupId, 'group id'));
  return { status: 'ok' as const };
}

export async function addGroupMembers(
  store: GroupsStore,
  userId: string,
  groupId: string,
  body: unknown,
) {
  const id = parseId(groupId, 'group id');
  return { added: await store.addMembers(userId, id, parseUserIds(body)) };
}

export async function removeGroupMember(
  store: GroupsStore,
  userId: string,
  groupId: string,
  memberId: string,
) {
  await store.removeMember(userId, parseId(groupId, 'group id'), parseId(memberId, 'user id'));
  return { status: 'ok' as const };
}

export async function leaveGroup(store: GroupsStore, userId: string, groupId: string) {
  await store.leave(userId, parseId(groupId, 'group id'));
  return { status: 'ok' as const };
}

export async function inviteToPick(
  store: GroupsStore,
  userId: string,
  pickId: string,
  body: unknown,
) {
  const id = parseId(pickId, 'Pick id');
  return { added: await store.invite(id, userId, parseUserIds(body)) };
}

/**
 * POST /picks. Without groupId this is exactly lifecycle's createPick. With one, the caller
 * must be a member; the draft is created as usual, then everyone in the group now is added.
 * If adding fails (the group changed in between), the empty draft is canceled so it does not
 * linger, and the error is returned.
 */
export async function createPickMaybeForGroup(
  lifecycle: LifecycleStore,
  groups: GroupsStore | undefined,
  userId: string,
  body: unknown,
) {
  const groupId = parseOptionalGroupId(body);
  if (!groupId) return createPick(lifecycle, userId, body);
  parseCreatePick(body); // 400 before any database work
  if (!groups) throw new ApiError(503, 'NOT_CONFIGURED', 'Groups are not available');
  if (!(await groups.isMember(groupId, userId))) {
    throw new ApiError(404, 'GROUP_NOT_FOUND', 'Group not found');
  }
  const created = await createPick(lifecycle, userId, body);
  try {
    const added = await groups.addGroupToPick(created.pickId, userId, groupId);
    return { ...created, groupId, added };
  } catch (error) {
    await lifecycle.cancel(created.pickId, userId).catch(() => undefined);
    throw error;
  }
}
