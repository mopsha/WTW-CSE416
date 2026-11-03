import { ApiError } from './errors.ts';
export interface GroupInvitation {
  id: string;
  groupId: string;
  inviterId: string;
  inviteeId: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: string;
  resolvedAt: string | null;
  groupName: string;
  inviterName: string | null;
  inviteeName: string | null;
}
export interface GroupInvitationsStore {
  list(userId: string, groupId?: string): Promise<GroupInvitation[]>;
  resolve(userId: string, id: string, decision: 'accepted' | 'declined'): Promise<GroupInvitation>;
}
export function parseGroupInvitationDecision(body: unknown): 'accepted' | 'declined' {
  const decision =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as { decision?: unknown }).decision
      : undefined;
  if (decision !== 'accepted' && decision !== 'declined')
    throw new ApiError(400, 'INVALID_INPUT', 'Choose accepted or declined');
  return decision;
}
