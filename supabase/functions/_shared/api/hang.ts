import { ApiError } from './errors.ts';
import { parseCreatePick, type CreatePickInput } from './lifecycle.ts';
import type { Notifier } from './notify.ts';
import { requireCleanText } from './text.ts';

function clean(activity: string): string {
  requireCleanText(activity, 'activity');
  return activity;
}

export const HANG_RSVP_WINDOW_MS = 4 * 3600000;
export type HangStatus = 'down' | 'maybe' | 'cant';
export interface HangInput {
  startsAt: string;
  expiresAt: string;
  activity: string;
  audience: 'all_friends' | 'group' | 'selected';
  groupIds?: string[];
  friendIds?: string[];
  requestId?: string;
  startNow?: boolean;
  groupId: string | null;
}
export interface HangPost extends Pick<
  HangInput,
  'startsAt' | 'expiresAt' | 'activity' | 'audience' | 'groupId'
> {
  id: string;
  authorId: string;
  authorName?: string | null;
  myStatus?: HangStatus | null;
  downCount?: number;
  maybeCount?: number;
  cantCount?: number;
  pickId?: string | null;
}
export interface HangAccess {
  blocked: boolean;
  acceptedFriends: boolean;
  groupMember: boolean;
  selectedRecipient?: boolean | null;
}
export interface HangStore {
  create(authorId: string, input: HangInput): Promise<HangPost & { recipientIds?: string[] }>;
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

export function parseHang(body: unknown, now = new Date(), allowMockIds = false): HangInput {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new ApiError(400, 'INVALID_INPUT', 'Expected a hang post');
  const b = body as Record<string, unknown>;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const validRecipientId = (id: string) =>
    uuid.test(id) || (allowMockIds && /^mock-[a-z0-9-]+$/i.test(id));
  const requestId = b.requestId;
  const startNow = b.startNow === true;
  const selected = b.audience === 'selected';
  const ids = (value: unknown): string[] | null =>
    Array.isArray(value) &&
    value.length <= 100 &&
    value.every((id) => typeof id === 'string' && validRecipientId(id))
      ? [...new Set(value.map((id) => (id as string).toLowerCase()))].sort()
      : null;
  const groupIds = selected ? ids(b.groupIds) : [];
  const friendIds = selected ? ids(b.friendIds) : [];
  if (
    (requestId !== undefined && (typeof requestId !== 'string' || !uuid.test(requestId))) ||
    (b.startNow !== undefined && typeof b.startNow !== 'boolean') ||
    ((startNow || selected) && !requestId) ||
    !groupIds ||
    !friendIds ||
    (selected && (b.groupId != null || groupIds.length + friendIds.length === 0)) ||
    (!selected && (b.groupIds !== undefined || b.friendIds !== undefined))
  )
    throw new ApiError(400, 'INVALID_INPUT', 'Choose a valid audience and time.');
  const starts = startNow
    ? now.getTime()
    : typeof b.startsAt === 'string'
      ? Date.parse(b.startsAt)
      : NaN;
  const expires = startNow
    ? starts + HANG_RSVP_WINDOW_MS
    : typeof b.expiresAt === 'string'
      ? Date.parse(b.expiresAt)
      : NaN;
  if (
    typeof b.activity !== 'string' ||
    !b.activity.trim() ||
    b.activity.trim().length > 60 ||
    !Number.isFinite(starts) ||
    (!requestId && starts < now.getTime()) ||
    starts > now.getTime() + 7 * 86400000 ||
    !Number.isFinite(expires) ||
    expires <= starts ||
    expires - starts > 86400000 ||
    !['all_friends', 'group', 'selected'].includes(b.audience as string) ||
    (b.audience === 'group' && (typeof b.groupId !== 'string' || !validRecipientId(b.groupId))) ||
    (b.audience === 'all_friends' && b.groupId != null)
  )
    throw new ApiError(400, 'INVALID_INPUT', 'Invalid activity, time or audience');
  return {
    startsAt: new Date(starts).toISOString(),
    expiresAt: new Date(expires).toISOString(),
    activity: clean(b.activity.trim()),
    audience: b.audience as HangInput['audience'],
    groupId: b.audience === 'group' ? (b.groupId as string) : null,
    ...(selected ? { groupIds, friendIds } : {}),
    ...(typeof requestId === 'string' ? { requestId: requestId.toLowerCase() } : {}),
    ...(startNow ? { startNow } : {}),
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
  if (access.selectedRecipient != null || post.audience === 'selected')
    return access.selectedRecipient === true;
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
  const input = parseCreatePick(body);
  if (input.proposedAt)
    throw new ApiError(400, 'INVALID_INPUT', 'Hang Picks keep their existing participation flow.');
  const result = await store.createPickForDown(postId, userId, input);
  // Existing notifier deduplicates inbox/push; retries can repair a lost notice.
  await store.notifier?.(result.participantIds, 'added_to_pick', result.pickId);
  return { pickId: result.pickId, isParticipant: result.participantIds.includes(userId) };
}
