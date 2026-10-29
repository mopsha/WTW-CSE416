import type { HangPost, HangStore } from '../_shared/api/hang.ts';
import { ApiError } from '../_shared/api/errors.ts';
import { createServiceClient } from './serviceClient.ts';

function post(row: Record<string, unknown>): HangPost {
  return {
    id: row.id as string,
    authorId: row.author_id as string,
    startsAt: row.starts_at as string,
    expiresAt: row.expires_at as string,
    activity: row.activity as string,
    audience: row.audience as HangPost['audience'],
    groupId: row.group_id as string | null,
  };
}
export function createHangStore(): HangStore {
  return {
    async create(authorId, input) {
      if (input.audience === 'group')
        throw new ApiError(
          503,
          'HANG_GROUPS_UNAVAILABLE',
          'Group hang posts are not available yet',
        );
      const { data, error } = await createServiceClient()
        .from('hang_posts')
        .insert({
          author_id: authorId,
          activity: input.activity,
          starts_at: input.startsAt,
          expires_at: input.expiresAt,
          audience: input.audience,
          group_id: input.groupId,
        })
        .select('*')
        .single();
      if (error) throw new ApiError(503, 'HANG_UNAVAILABLE', 'Could not create hang post');
      return post(data);
    },
    async listOwn(userId, now) {
      const { data, error } = await createServiceClient()
        .from('hang_posts')
        .select('*')
        .eq('author_id', userId)
        .gt('expires_at', now)
        .order('starts_at')
        .limit(20);
      if (error) throw new ApiError(503, 'HANG_UNAVAILABLE', 'Hang posts unavailable');
      return (data ?? []).map(post);
    },
    async load(id) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
      const { data, error } = await createServiceClient()
        .from('hang_posts')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error) throw new ApiError(503, 'HANG_UNAVAILABLE', 'Hang posts unavailable');
      return data ? post(data) : null;
    },
    // No graph, atomic response/invite RPC or backend notify helper exists.
    // Deliberately leave those capabilities absent rather than bypass authorization.
  };
}
