import { JOIN_RATE_LIMITED } from '../_shared/api/join.ts';
import {
  INVITE_NOT_FOUND,
  type InviteKind,
  type InviteLink,
  type InviteStore,
} from '../_shared/api/invites.ts';
import { rpcError } from './rpcErrors.ts';
import { createServiceClient } from './serviceClient.ts';

type AcceptResult =
  | { ok: true; kind: InviteKind; targetId: string }
  | { ok: false; reason: 'invalid' | 'rate_limited' };

/** Service-role adapter for invite_create, invite_accept, invite_revoke (0014). */
export function createInviteStore(): InviteStore {
  return {
    async create(userId, input) {
      const { data, error } = await createServiceClient().rpc('invite_create', {
        p_user_id: userId,
        p_kind: input.kind,
        p_target_id: input.targetId,
        p_max_uses: input.maxUses,
      });
      if (error) rpcError(error, input.kind === 'pick' ? 'Pick not found' : 'Group not found');
      return data as InviteLink;
    },
    async accept(token, userId) {
      const { data, error } = await createServiceClient().rpc('invite_accept', {
        p_token: token,
        p_user_id: userId,
      });
      if (error) rpcError(error);
      const result = data as AcceptResult;
      if (result.ok) return { kind: result.kind, targetId: result.targetId };
      throw result.reason === 'rate_limited' ? JOIN_RATE_LIMITED : INVITE_NOT_FOUND;
    },
    async revoke(token, userId) {
      const { error } = await createServiceClient().rpc('invite_revoke', {
        p_token: token,
        p_user_id: userId,
      });
      if (error) rpcError(error, 'Invite not found');
    },
  };
}
