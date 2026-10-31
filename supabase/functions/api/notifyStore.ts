import { ApiError } from '../_shared/api/errors.ts';
import type { NotificationRow, NotifyStore } from '../_shared/api/notify.ts';
import { createServiceClient } from './serviceClient.ts';

function fail(error: { code: string }): never {
  if (error.code === 'PGRST202' || error.code === '42P01') {
    throw new ApiError(503, 'DATABASE_NOT_READY', 'Notifications are not installed');
  }
  if (error.code === 'PT404') {
    throw new ApiError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found');
  }
  if (error.code === 'PT403') {
    throw new ApiError(403, 'FORBIDDEN', 'Your account is not ready yet; try again');
  }
  throw new Error('Database operation failed');
}

interface Row {
  id: string;
  type: NotificationRow['type'];
  pick_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
  read_at: string | null;
}

/** Service-role adapter for 0009_notifications.sql. */
export function createNotifyStore(): NotifyStore {
  return {
    async insert(userIds, type, pickId, payload) {
      const { data, error } = await createServiceClient().rpc('notify_insert', {
        p_user_ids: userIds,
        p_type: type,
        p_pick_id: pickId,
        p_payload: payload,
      });
      if (error) fail(error);
      return (data ?? []) as string[];
    },
    async tokensFor(userIds) {
      const { data, error } = await createServiceClient()
        .from('push_tokens')
        .select('token')
        .in('user_id', userIds);
      if (error) fail(error);
      return (data ?? []).map((r: { token: string }) => r.token);
    },
    async deleteTokens(tokens) {
      const { error } = await createServiceClient()
        .from('push_tokens')
        .delete()
        .in('token', tokens);
      if (error) fail(error);
    },
    async list(userId, limit) {
      const { data, error } = await createServiceClient()
        .from('notifications')
        .select('id, type, pick_id, payload, created_at, read_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) fail(error);
      return ((data ?? []) as Row[]).map((r) => ({
        id: r.id,
        type: r.type,
        pickId: r.pick_id,
        payload: r.payload,
        createdAt: r.created_at,
        readAt: r.read_at,
      }));
    },
    async markRead(id, userId) {
      const { error } = await createServiceClient().rpc('notification_mark_read', {
        p_id: id,
        p_user_id: userId,
      });
      if (error) fail(error);
    },
    async registerToken(userId, token, platform) {
      const { error } = await createServiceClient().rpc('push_token_register', {
        p_user_id: userId,
        p_token: token,
        p_platform: platform,
      });
      if (error) fail(error);
    },
  };
}
