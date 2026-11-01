// Invite links (Razin, M4). POST /invites, POST /invites/:token/accept, DELETE /invites/:token.
// Who may make, use and revoke a link is enforced atomically by invite_create /
// invite_accept / invite_revoke in 0014_invites_safety.sql; this layer validates input.

import { ApiError } from './errors.ts';
import { inviteUrl, parseInviteToken } from '../domain/inviteLink.ts';

export type InviteKind = 'pick' | 'group';
export interface CreateInviteInput {
  kind: InviteKind;
  targetId: string;
  maxUses: number | null;
}
export interface InviteLink {
  token: string;
  kind: InviteKind;
  targetId: string;
  expiresAt: string;
  maxUses: number | null;
}

/**
 * Database adapter (service role). accept rejects every unusable link with the same 404
 * INVITE_NOT_FOUND (unknown, expired, revoked, used up, closed, locked, full, blocked) and
 * 429 RATE_LIMITED after 10 failed joins in an hour.
 */
export interface InviteStore {
  create(userId: string, input: CreateInviteInput): Promise<InviteLink>;
  accept(token: string, userId: string): Promise<{ kind: InviteKind; targetId: string }>;
  revoke(token: string, userId: string): Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const INVITE_NOT_FOUND = new ApiError(
  404,
  'INVITE_NOT_FOUND',
  'That invite link isn’t valid any more. Ask for a new one.',
);

export function parseCreateInvite(body: unknown): CreateInviteInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ApiError(400, 'INVALID_INPUT', 'Expected an invite object');
  }
  const { kind, targetId, maxUses } = body as Record<string, unknown>;
  const uses = maxUses ?? null;
  if (
    (kind !== 'pick' && kind !== 'group') ||
    typeof targetId !== 'string' ||
    !UUID.test(targetId) ||
    (uses !== null && (!Number.isInteger(uses) || (uses as number) < 1 || (uses as number) > 100))
  ) {
    throw new ApiError(
      400,
      'INVALID_INPUT',
      'Expected kind pick or group, a targetId, and maxUses 1 to 100 or null',
    );
  }
  return { kind, targetId: targetId.toLowerCase(), maxUses: uses as number | null };
}

export async function createInvite(store: InviteStore, userId: string, body: unknown) {
  const link = await store.create(userId, parseCreateInvite(body));
  return { ...link, url: inviteUrl(link.token) };
}

export async function acceptInvite(store: InviteStore, token: string | undefined, userId: string) {
  const parsed = parseInviteToken(token ?? '');
  // A malformed token looks like any other unusable one.
  if (!parsed) throw INVITE_NOT_FOUND;
  return await store.accept(parsed, userId);
}

export async function revokeInvite(store: InviteStore, token: string | undefined, userId: string) {
  const parsed = parseInviteToken(token ?? '');
  if (!parsed) throw new ApiError(404, 'NOT_FOUND', 'Invite not found');
  await store.revoke(parsed, userId);
  return { status: 'ok' as const };
}
