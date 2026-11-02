import type { HangStore } from '../_shared/api/hang.ts';
import type { Notifier } from '../_shared/api/notify.ts';
import { ApiError } from '../_shared/api/errors.ts';
import { createServiceClient } from './serviceClient.ts';

function fail(error: { code?: string; message?: string; hint?: string }): never {
  const statuses = { PT400: 400, PT403: 403, PT404: 404, PT409: 409, PT429: 429 } as const;
  const status = statuses[error.code as keyof typeof statuses];
  if (status)
    throw new ApiError(
      status,
      status === 404
        ? 'HANG_NOT_FOUND'
        : status === 429
          ? 'RATE_LIMITED'
          : error.hint === 'no_down'
            ? 'NO_DOWN_RESPONSES'
            : 'HANG_CONFLICT',
      status === 404 ? 'Hang post not found' : (error.message ?? 'Hang request rejected'),
    );
  throw new ApiError(503, 'HANG_UNAVAILABLE', 'Hang posts unavailable');
}
const validId = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
export function createHangStore(notifier?: Notifier): HangStore {
  async function rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await createServiceClient().rpc(name, args);
    if (error) fail(error);
    return data;
  }
  return {
    notifier,
    create: (user, input) => rpc('hang_create', { p_user: user, p_input: input }),
    listOwn: (user) => rpc('hang_list', { p_user: user }), // Kept name for API compatibility; now visible shared posts.
    async load(id, user) {
      if (!validId(id) || !user) return null;
      return rpc('hang_get', { p_id: id, p_user: user });
    },
    access: async (post, user) =>
      (await rpc('hang_access', { p_id: post.id, p_user: user })) ?? {
        blocked: true,
        acceptedFriends: false,
        groupMember: false,
      },
    respondAuthorized: (id, user, status) =>
      rpc('hang_respond', { p_id: id, p_user: user, p_status: status }),
    createPickForDown: (id, user, input) =>
      rpc('hang_create_pick', { p_id: id, p_user: user, p_input: input }),
  };
}
