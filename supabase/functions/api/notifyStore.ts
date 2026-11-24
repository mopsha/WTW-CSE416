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

function mapRows(data: Row[] | null): NotificationRow[] {
  return (data ?? []).map((r) => ({
    id: r.id,
    type: r.type,
    pickId: r.pick_id,
    payload: r.payload,
    createdAt: r.created_at,
    readAt: r.read_at,
  }));
}

/** Service-role adapter for 0009_notifications.sql. */
export function createNotifyStore(): NotifyStore {
  return {
    async insert(userIds, type, pickId, payload) {
      const { data, error } = await createServiceClient().rpc('notification_record', {
        p_user_ids: userIds,
        p_type: type,
        p_pick_id: pickId,
        p_payload: payload,
      });
      if (error) fail(error);
      return (data ?? []) as string[];
    },
    async pushTargets(ids, hang) {
      const { data, error } = await createServiceClient().rpc('notification_push_targets', {
        p_ids: ids,
        p_hang_id: hang?.id ?? null,
        p_hang_users: hang?.userIds ?? null,
      });
      if (error) fail(error);
      return data ?? [];
    },
    async deleteTokens(tokens) {
      const { error } = await createServiceClient()
        .from('push_tokens')
        .delete()
        .in('token', tokens);
      if (error) fail(error);
    },
    async list(userId, limit, before) {
      const { data, error } = await createServiceClient().rpc('notification_feed', {
        p_user: userId,
        p_limit: limit,
        p_before: before?.createdAt ?? null,
        p_before_id: before?.id ?? null,
      });
      if (error) fail(error);
      return mapRows(data);
    },
    async revalidate(userId, ids) {
      const { data, error } = await createServiceClient().rpc('notification_revalidate', {
        p_user: userId,
        p_ids: ids,
      });
      if (error) fail(error);
      return mapRows(data);
    },
    async markRead(id, userId) {
      const { error } = await createServiceClient().rpc('notification_mark_read', {
        p_id: id,
        p_user_id: userId,
      });
      if (error) fail(error);
    },
    async removeToken(userId, token) {
      const { error } = await createServiceClient().rpc('push_token_remove', {
        p_user_id: userId,
        p_token: token,
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
