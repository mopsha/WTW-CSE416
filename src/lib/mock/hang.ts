import {
  canSeeHang,
  HANG_RSVP_WINDOW_MS,
  parseHang,
  respondHang,
  hangPick,
  type HangInput,
  type HangPost,
  type HangStatus,
  type HangStore,
} from '@shared/api/hang.ts';
import { ApiError, errorResponse } from '@shared/api/errors.ts';
import { MOCK_USER_ID } from './auth';
import { mockFriendsList } from './friends';
import { mockGetGroup, mockParticipant, mockAssociateGroupPick } from './groups';
import { createMockPick, mockPicks, mockBlocks } from './store';

export const mockHangPosts: HangPost[] = [];
const grants = new Map<string, { user: string; group?: string }[]>();
const sent = new Map<string, { post: HangPost; fingerprint: string }>();
export const mockHangResponses = new Map<string, Map<string, HangStatus>>();
export function resetMockHang() {
  mockHangPosts.length = 0;
  mockHangResponses.clear();
  grants.clear();
  sent.clear();
}
const responses = (id: string) => {
  if (!mockHangResponses.has(id)) mockHangResponses.set(id, new Map());
  return mockHangResponses.get(id)!;
};
function access(post: HangPost, user: string) {
  const other = post.authorId === MOCK_USER_ID ? user : post.authorId;
  const knownPair = user === MOCK_USER_ID || post.authorId === MOCK_USER_ID;
  return {
    blocked: knownPair && mockBlocks.has(other),
    acceptedFriends: knownPair && mockFriendsList().friends.some((f) => f.userId === other),
    groupMember:
      !!post.groupId && !!mockGetGroup(post.groupId)?.members.some((m) => m.userId === user),
    selectedRecipient: grants
      .get(post.id)
      ?.some(
        (grant) =>
          grant.user === user &&
          (grant.group
            ? [post.authorId, user].every((id) =>
                mockGetGroup(grant.group!)?.members.some((member) => member.userId === id),
              )
            : knownPair && mockFriendsList().friends.some((friend) => friend.userId === other)),
      ),
  };
}
const visible = (p: HangPost, user: string) => canSeeHang(p, user, access(p, user));
function project(post: HangPost, user: string): HangPost {
  const current = [...responses(post.id)].filter(([id]) => visible(post, id));
  const count = (status: HangStatus) => current.filter(([, value]) => value === status).length;
  return {
    ...post,
    authorName:
      post.authorId === MOCK_USER_ID
        ? 'You'
        : (mockFriendsList().friends.find((f) => f.userId === post.authorId)?.displayName ??
          'Group member'),
    myStatus: responses(post.id).get(user) ?? null,
    downCount: count('down'),
    maybeCount: count('maybe'),
    cantCount: count('cant'),
  };
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
export async function mockHang(
  method: string,
  path: string,
  body: unknown,
  notify?: (ids: string[], pickId: string) => void,
): Promise<Response | null> {
  if (path !== '/hang' && !/^\/hang\/[^/]+(?:\/(respond|pick))?$/.test(path)) return null;
  const store: HangStore = {
    async create(user, input) {
      const key = input.requestId && `${user}:${input.requestId}`;
      const existing = key ? sent.get(key) : undefined;
      const fingerprint = JSON.stringify([
        input.activity,
        input.audience,
        input.groupId,
        input.groupIds,
        input.friendIds,
        input.startNow === true,
        input.startNow ? null : input.startsAt,
        input.startNow ? null : input.expiresAt,
      ]);
      if (existing) {
        if (existing.fingerprint !== fingerprint)
          throw new ApiError(
            409,
            'HANG_REQUEST_MISMATCH',
            'This send was already used for a different Hang.',
          );
        if (Date.parse(existing.post.expiresAt) <= Date.now())
          throw new ApiError(409, 'HANG_CONFLICT', 'This Hang was already sent and has ended.');
        return existing.post;
      }
      const now = Date.now();
      if (input.startNow) {
        input = {
          ...input,
          startsAt: new Date(now).toISOString(),
          expiresAt: new Date(now + HANG_RSVP_WINDOW_MS).toISOString(),
        };
      } else if (Date.parse(input.startsAt) < now) {
        throw new ApiError(400, 'INVALID_INPUT', 'Choose a future date and time.');
      }
      const recipientGrants: { user: string; group?: string }[] = [];
      const groups = input.audience === 'group' ? [input.groupId!] : (input.groupIds ?? []);
      const friends = mockFriendsList().friends.map((friend) => friend.userId);
      for (const group of groups) {
        const members = mockGetGroup(group)?.members;
        if (!members?.some((member) => member.userId === user))
          throw new ApiError(403, 'FORBIDDEN', 'Join this group before posting');
        for (const member of members)
          if (member.userId !== user && !mockBlocks.has(member.userId))
            recipientGrants.push({ user: member.userId, group });
      }
      for (const friend of input.audience === 'all_friends' ? friends : (input.friendIds ?? [])) {
        if (!friends.includes(friend) || mockBlocks.has(friend))
          throw new ApiError(
            403,
            'FORBIDDEN',
            'One of the selected friends is no longer available.',
          );
        recipientGrants.push({ user: friend });
      }
      if (key && !recipientGrants.length)
        throw new ApiError(400, 'INVALID_INPUT', 'Nobody in this audience can receive the Hang.');
      const { activity, startsAt, expiresAt, audience } = input;
      const groupId = groups.length === 1 && !input.friendIds?.length ? groups[0]! : null;
      const post = {
        activity,
        startsAt,
        expiresAt,
        audience,
        groupId,
        id: `mock-hang-${mockHangPosts.length + 1}`,
        authorId: user,
      };
      grants.set(post.id, recipientGrants);
      if (key) sent.set(key, { post, fingerprint });
      mockHangPosts.push(post);
      return post;
    },
    async listOwn(user) {
      return mockHangPosts
        .filter((p) => visible(p, user))
        .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id))
        .slice(0, 20)
        .map((post) => project(post, user));
    },
    async load(id, user) {
      const post = mockHangPosts.find((p) => p.id === id);
      return post && user && visible(post, user) ? project(post, user) : null;
    },
    access: async (post, user) => access(post, user),
    async respondAuthorized(id, user, status) {
      const post = mockHangPosts.find((p) => p.id === id);
      if (!post || !visible(post, user))
        throw new ApiError(404, 'HANG_NOT_FOUND', 'Hang post not found');
      responses(id).set(user, status);
    },
    async createPickForDown(id, user, input) {
      const post = mockHangPosts.find((p) => p.id === id)!;
      if (post.audience === 'group' && !mockGetGroup(post.groupId!))
        throw new ApiError(403, 'FORBIDDEN', 'You are no longer in this group');
      const ids = [...responses(id)]
        .filter(([id, status]) => status === 'down' && visible(post, id))
        .map(([id]) => id)
        .sort();
      if (!ids.length) throw new ApiError(409, 'NO_DOWN_RESPONSES', 'Nobody eligible is down yet');
      if (ids.length > 30)
        throw new ApiError(409, 'HANG_CONFLICT', 'A Pick can have at most 30 people');
      const existing = post.pickId ? mockPicks.get(post.pickId) : undefined;
      if (existing?.state === 'draft') {
        if (
          JSON.stringify(existing.participants.map((p) => p.userId).sort()) !== JSON.stringify(ids)
        )
          throw new ApiError(
            409,
            'HANG_CONFLICT',
            'Responses changed. Cancel the existing Pick before creating another',
          );
        return { pickId: existing.id, participantIds: ids, created: false };
      }
      if (existing && !['completed', 'canceled'].includes(existing.state))
        throw new ApiError(409, 'HANG_CONFLICT', 'This hang already has a Pick in progress');
      const pick = createMockPick(input, ids.includes(user) ? user : ids[0]!);
      pick.planAt = post.startsAt;
      pick.participants = ids.map(mockParticipant);
      if (post.groupId) mockAssociateGroupPick(pick.id, post.groupId);
      post.pickId = pick.id;
      return { pickId: pick.id, participantIds: ids, created: true };
    },
    notifier: async (ids, _type, pickId) => {
      if (pickId) notify?.([...ids], pickId);
    },
  };
  try {
    if (path === '/hang' && method === 'GET')
      return json({
        posts: await store.listOwn(MOCK_USER_ID, new Date().toISOString()),
        sharedAvailable: true,
        notice: '',
      });
    const item = /^\/hang\/([^/]+)$/.exec(path);
    if (method === 'GET' && item) {
      const post = await store.load(decodeURIComponent(item[1]!), MOCK_USER_ID);
      if (!post) throw new ApiError(404, 'HANG_NOT_FOUND', 'Hang post not found');
      return json(post);
    }
    if (path === '/hang' && method === 'POST') {
      const input: HangInput = parseHang(body, new Date(), true);
      return json(await store.create(MOCK_USER_ID, input), 201);
    }
    const match = /^\/hang\/([^/]+)\/(respond|pick)$/.exec(path);
    if (method === 'POST' && match)
      return json(
        match[2] === 'respond'
          ? await respondHang(store, decodeURIComponent(match[1]!), MOCK_USER_ID, body)
          : await hangPick(store, decodeURIComponent(match[1]!), MOCK_USER_ID, new Date(), body),
      );
    return json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404);
  } catch (error) {
    const safe = errorResponse(error);
    return json(safe.body, safe.status);
  }
}
