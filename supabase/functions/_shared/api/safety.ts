// Blocking, reports and the lobby lock (Razin, M4). Rules live in 0014_invites_safety.sql;
// this layer validates input. POST /blocks/:userId, POST /blocks/:userId/remove,
// POST /reports, POST /picks/:id/lock.

import { ApiError } from './errors.ts';

export type ReportKind =
  'user' | 'pick' | 'group' | 'group_message' | 'direct_message' | 'profile_photo';
export interface ReportInput {
  kind: ReportKind;
  targetId: string;
  reason: string;
  photoRevision?: number;
}

/** Database adapter (service role). Mutations recheck everything atomically. */
export interface BlockedUser {
  userId: string;
  displayName: string | null;
}

export interface SafetyStore {
  /** Only blocks created by the verified caller; never reverse blocks or private metadata. */
  listBlocks?(userId: string): Promise<BlockedUser[]>;
  block(userId: string, targetId: string): Promise<void>;
  unblock(userId: string, targetId: string): Promise<void>;
  /** 404 for something the reporter can't see, 429 past 10 a day. */
  report(userId: string, input: ReportInput): Promise<void>;
  setLobbyLocked(pickId: string, userId: string, locked: boolean): Promise<boolean>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REPORT_KINDS: readonly ReportKind[] = [
  'user',
  'pick',
  'group',
  'group_message',
  'direct_message',
  'profile_photo',
];
export const REPORT_REASON_MAX = 500;

export function parseUserId(value: string | undefined): string {
  if (!value || !UUID.test(value)) throw new ApiError(400, 'INVALID_INPUT', 'Expected a user id');
  return value.toLowerCase();
}

function objectBody(body: unknown, what: string): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ApiError(400, 'INVALID_INPUT', `Expected a ${what} object`);
  }
  return body as Record<string, unknown>;
}

export function parseReport(body: unknown): ReportInput {
  const { kind, targetId, reason, photoRevision } = objectBody(body, 'report');
  const text = typeof reason === 'string' ? reason.trim() : '';
  if (
    !REPORT_KINDS.includes(kind as ReportKind) ||
    typeof targetId !== 'string' ||
    !UUID.test(targetId) ||
    text.length < 1 ||
    text.length > REPORT_REASON_MAX ||
    (kind === 'profile_photo' &&
      (!Number.isSafeInteger(photoRevision) || Number(photoRevision) < 0))
  ) {
    throw new ApiError(
      400,
      'INVALID_INPUT',
      `Expected a report kind, a targetId, and a reason of 1 to ${REPORT_REASON_MAX} characters`,
    );
  }
  return {
    kind: kind as ReportKind,
    targetId: targetId.toLowerCase(),
    reason: text,
    ...(kind === 'profile_photo' ? { photoRevision: photoRevision as number } : {}),
  };
}

export async function blockUser(store: SafetyStore, userId: string, target: string | undefined) {
  const targetId = parseUserId(target);
  if (targetId === userId) throw new ApiError(400, 'INVALID_INPUT', 'You can’t block yourself');
  await store.block(userId, targetId);
  return { status: 'ok' as const };
}

export async function unblockUser(store: SafetyStore, userId: string, target: string | undefined) {
  await store.unblock(userId, parseUserId(target));
  return { status: 'ok' as const };
}

export async function createReport(store: SafetyStore, userId: string, body: unknown) {
  await store.report(userId, parseReport(body));
  return { status: 'ok' as const };
}

export async function setLobbyLocked(
  store: SafetyStore,
  pickId: string,
  userId: string,
  body: unknown,
) {
  const { locked } = objectBody(body, 'lock');
  if (typeof locked !== 'boolean') {
    throw new ApiError(400, 'INVALID_INPUT', 'Expected locked: true or false');
  }
  return { locked: await store.setLobbyLocked(pickId, userId, locked) };
}
