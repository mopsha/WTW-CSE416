import { ApiError } from './errors.ts';
import { parseCreatePick, type CreatePickInput } from './lifecycle.ts';
import type { Notifier } from './notify.ts';
import { requireCleanText } from './text.ts';

function clean(activity: string): string {
  requireCleanText(activity, 'activity');
  return activity;
}

export type HangStatus = 'down' | 'maybe' | 'cant';
export interface HangInput {
  startsAt: string;
  expiresAt: string;
  activity: string;
  audience: 'all_friends' | 'group';
  groupId: string | null;
}
export interface HangPost extends HangInput {
  id: string;
  authorId: string;
  authorName?: string | null;
  myStatus?: HangStatus | null;
  downCount?: number;
  pickId?: string | null;
}
export interface HangAccess {
  blocked: boolean;
  acceptedFriends: boolean;
  groupMember: boolean;
}
export interface HangStore {
  create(authorId: string, input: HangInput): Promise<HangPost>;
  listOwn(userId: string, now: string): Promise<HangPost[]>;
  load(id: string, userId?: string): Promise<HangPost | null>;
  /** Razin's relationship helper must account for blocks in BOTH directions. */
  access?(post: HangPost, userId: string): Promise<HangAccess>;
  /** Must recheck graph, expiry and uniqueness atomically with the write. */
  respondAuthorized?(postId: string, userId: string, status: HangStatus): Promise<void>;
  /** Select current eligible downs and call canonical Pick creation atomically. */
  createPickForDown?(
    postId: string,
    authorId: string,
    input: CreatePickInput,
  ): Promise<{
    pickId: string;
    participantIds: string[];
    created: boolean;
  }>;
  notifier?: Notifier;
}

export function parseHang(body: unknown, now = new Date()): HangInput {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new ApiError(400, 'INVALID_INPUT', 'Expected a hang post');
  const b = body as Record<string, unknown>;
  const starts = typeof b.startsAt === 'string' ? Date.parse(b.startsAt) : NaN;
  const expires = typeof b.expiresAt === 'string' ? Date.parse(b.expiresAt) : NaN;
  if (
    typeof b.activity !== 'string' ||
    !b.activity.trim() ||
    b.activity.trim().length > 60 ||
    !Number.isFinite(starts) ||
    starts < now.getTime() ||
    starts > now.getTime() + 7 * 86400000 ||
    !Number.isFinite(expires) ||
    expires <= starts ||
    expires - starts > 86400000 ||
    !['all_friends', 'group'].includes(b.audience as string) ||
    (b.audience === 'group' &&
      (typeof b.groupId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          b.groupId,
        ))) ||
    (b.audience === 'all_friends' && b.groupId != null)
  )
    throw new ApiError(400, 'INVALID_INPUT', 'Invalid activity, time or audience');
  return {
    startsAt: new Date(starts).toISOString(),
    expiresAt: new Date(expires).toISOString(),
    activity: clean(b.activity.trim()),
    audience: b.audience as HangInput['audience'],
    groupId: b.audience === 'group' ? (b.groupId as string) : null,
  };
}
export function canSeeHang(
  post: HangPost,
  userId: string,
  access: HangAccess,
  now = new Date(),
): boolean {
  if (
    Date.parse(post.expiresAt) <= now.getTime() ||
    !Number.isFinite(Date.parse(post.expiresAt)) ||
    access.blocked
  )
    return false;
  if (post.authorId === userId) return true;
  return post.audience === 'all_friends' ? access.acceptedFriends : access.groupMember;
}
export function downUserIds(responses: { userId: string; status: HangStatus }[]): string[] {
  return [...new Set(responses.filter((r) => r.status === 'down').map((r) => r.userId))].sort();
}
export async function respondHang(
  store: HangStore,
  postId: string,
  userId: string,
  body: unknown,
  now = new Date(),
) {
  const status = (body as { status?: unknown } | null)?.status;
  if (!['down', 'maybe', 'cant'].includes(status as string))
    throw new ApiError(400, 'INVALID_INPUT', 'Choose down, maybe or cant');
  const post = await store.load(postId, userId);
  if (!post || Date.parse(post.expiresAt) <= now.getTime())
    throw new ApiError(404, 'HANG_NOT_FOUND', 'Hang post not found');
  if (!store.access || !store.respondAuthorized)
    throw new ApiError(
      503,
      'HANG_RELATIONSHIPS_UNAVAILABLE',
      'Shared hang posts are not available yet',
    );
  if (!canSeeHang(post, userId, await store.access(post, userId), now))
    throw new ApiError(404, 'HANG_NOT_FOUND', 'Hang post not found');
  await store.respondAuthorized(postId, userId, status as HangStatus);
  return { status: 'ok' };
}
export async function hangPick(
  store: HangStore,
  postId: string,
  userId: string,
  now = new Date(),
  body?: unknown,
) {
  const post = await store.load(postId, userId);
  if (!post || Date.parse(post.expiresAt) <= now.getTime())
    throw new ApiError(404, 'HANG_NOT_FOUND', 'Hang post not found');
  if (post.authorId !== userId)
    throw new ApiError(403, 'FORBIDDEN', 'Only the author can create this Pick');
  if (!store.createPickForDown)
    throw new ApiError(
      503,
      'HANG_PICK_HELPER_UNAVAILABLE',
      'Creating a Pick from responses is not available yet',
    );
  const result = await store.createPickForDown(postId, userId, parseCreatePick(body));
  // Existing notifier deduplicates inbox/push; retries can repair a lost notice.
  await store.notifier?.(result.participantIds, 'added_to_pick', result.pickId);
  return { pickId: result.pickId, isParticipant: result.participantIds.includes(userId) };
}
