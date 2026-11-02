import {
  canSeeHang,
  parseHang,
  respondHang,
  hangPick,
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
export const mockHangResponses = new Map<string, Map<string, HangStatus>>();
export function resetMockHang() {
  mockHangPosts.length = 0;
  mockHangResponses.clear();
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
  };
}
const visible = (p: HangPost, user: string) => canSeeHang(p, user, access(p, user));
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
  if (path !== '/hang' && !/^\/hang\/[^/]+\/(respond|pick)$/.test(path)) return null;
  const store: HangStore = {
    async create(user, input) {
      if (input.audience === 'group' && !mockGetGroup(input.groupId!))
        throw new ApiError(403, 'FORBIDDEN', 'Join this group before posting');
      const post = { ...input, id: `mock-hang-${mockHangPosts.length + 1}`, authorId: user };
      mockHangPosts.push(post);
      return post;
    },
    async listOwn(user) {
      return mockHangPosts
        .filter((p) => visible(p, user))
        .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id))
        .slice(0, 20)
        .map((p) => ({
          ...p,
          authorName:
            p.authorId === MOCK_USER_ID
              ? 'You'
              : (mockFriendsList().friends.find((f) => f.userId === p.authorId)?.displayName ??
                'Group member'),
          myStatus: responses(p.id).get(user) ?? null,
          downCount: [...responses(p.id)].filter(
            ([id, status]) => status === 'down' && visible(p, id),
          ).length,
        }));
    },
    async load(id, user) {
      return mockHangPosts.find((p) => p.id === id && !!user && visible(p, user)) ?? null;
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
    if (path === '/hang' && method === 'POST') {
      const raw = body as { audience?: string; groupId?: string };
      if (raw?.audience === 'group' && (typeof raw.groupId !== 'string' || !raw.groupId.trim()))
        throw new ApiError(400, 'INVALID_INPUT', 'Choose a group');
      const input = parseHang(
        raw?.audience === 'group'
          ? { ...raw, groupId: '00000000-0000-4000-8000-000000000000' }
          : body,
      );
      if (raw?.audience === 'group') input.groupId = raw.groupId ?? null;
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
