import { ApiError } from '../_shared/api/errors.ts';
import type { AvatarChange, AvatarStore } from '../_shared/api/avatars.ts';
import { normalizeAvatar } from './avatarImage.ts';
import { createServiceClient } from './serviceClient.ts';

const BUCKET = 'profile-photos';
export function avatarError(error: { code?: string }): never {
  if (error.code === 'PGRST202')
    throw new ApiError(503, 'PHOTO_UNAVAILABLE', 'Photos are not installed');
  if (error.code === 'PT404') throw new ApiError(404, 'PHOTO_UNAVAILABLE', 'Photo unavailable');
  if (error.code === 'PT409')
    throw new ApiError(409, 'PHOTO_CONFLICT', 'Photo changed; reload before retrying');
  if (error.code === 'PT400') throw new ApiError(400, 'INVALID_IMAGE', 'Invalid photo');
  if (error.code === 'PT429')
    throw new ApiError(429, 'PHOTO_RATE_LIMITED', 'Too many photo uploads');
  throw new Error('Photo operation failed');
}

export function createAvatarStore(
  client: typeof createServiceClient = createServiceClient,
): AvatarStore {
  async function rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await client().rpc(name, args);
    if (error) avatarError(error);
    return data;
  }
  async function removeObjects(paths: string[]) {
    if (!paths.length) return;
    const { error } = await client().storage.from(BUCKET).remove(paths);
    if (error) throw new Error('Photo cleanup failed');
  }
  async function change(
    user: string,
    revision: number,
    path: string | null,
  ): Promise<AvatarChange> {
    const result = (await rpc('avatar_change', {
      p_user_id: user,
      p_revision: revision,
      p_path: path,
    })) as AvatarChange & { previousPath: string | null };
    if (result.previousPath) {
      // The DB change is already committed. Cleanup failure must not turn a
      // successful replacement into an apparent failure. Sweep retries old orphans.
      try {
        await removeObjects([result.previousPath]);
      } catch {
        /* swept after 24h */
      }
    }
    return { revision: result.revision, avatarRef: result.avatarRef };
  }
  return {
    async resolve(viewer, ids) {
      if (
        (await rpc('consume_avatar_limit', { p_user_id: viewer, p_kind: 'avatar_resolve' })) !==
        true
      )
        throw new ApiError(429, 'PHOTO_RATE_LIMITED', 'Photo request limit reached');
      return (await rpc('avatar_refs', { p_viewer_id: viewer, p_target_ids: ids })) as Record<
        string,
        AvatarChange
      >;
    },
    async upload(user, revision, bytes) {
      await rpc('avatar_prepare', { p_user_id: user, p_revision: revision });
      const canonical = normalizeAvatar(bytes);
      const path = `${user}/${crypto.randomUUID()}.jpg`;
      const { error } = await client().storage.from(BUCKET).upload(path, canonical, {
        contentType: 'image/jpeg',
        cacheControl: '0',
        upsert: false,
      });
      if (error) throw new Error('Photo upload failed');
      // A transport error may mean the commit succeeded but its reply was lost.
      // Never delete this candidate until the DB proves it is an orphan.
      return change(user, revision, path);
    },
    remove: (user, revision) => change(user, revision, null),
    async read(viewer, target, revision) {
      if (
        (await rpc('consume_avatar_limit', { p_user_id: viewer, p_kind: 'avatar_read' })) !== true
      )
        throw new ApiError(429, 'PHOTO_RATE_LIMITED', 'Photo request limit reached');
      const args = { p_viewer_id: viewer, p_target_id: target, p_revision: revision };
      const path = (await rpc('avatar_read', args)) as string;
      let data: Blob | null;
      try {
        const result = await client().storage.from(BUCKET).download(path);
        if (result.error) {
          const status = Number(result.error.statusCode);
          if (
            [400, 401, 403, 404].includes(status) &&
            (status !== 400 || result.error.message === 'Object not found')
          )
            throw new ApiError(404, 'PHOTO_UNAVAILABLE', 'Photo unavailable');
          throw new Error('Storage unavailable');
        }
        data = result.data;
        if (!data) throw new Error('Storage returned no image');
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(503, 'PHOTO_UNAVAILABLE', 'Photo temporarily unavailable');
      }
      // Recheck after Storage I/O: do not return a newly revoked/replaced image.
      await rpc('avatar_read', args);
      return new Uint8Array(await data.arrayBuffer());
    },
    async cleanup() {
      const token = await rpc('avatar_cleanup_claim', {});
      if (!token) return;
      let success = false;
      try {
        await removeObjects((await rpc('avatar_orphans', {})) as string[]);
        success = true;
      } finally {
        await rpc('avatar_cleanup_finish', { p_token: token, p_success: success });
      }
    },
  };
}

/** Deletion is retryable. Freeze writes first; in-flight uploads can no longer
 * finalize. Late objects from interrupted requests are also covered by sweep. */
export async function deleteAccountPhotos(
  userId: string,
  client = createServiceClient(),
): Promise<void> {
  const { error } = await client.rpc('avatar_begin_account_delete', { p_user_id: userId });
  if (error) avatarError(error);
  const bucket = client.storage.from(BUCKET);
  for (let batch = 0; batch < 10; batch++) {
    const { data, error: listError } = await bucket.list(userId, { limit: 100, offset: 0 });
    if (listError || !data) throw new Error('Photo cleanup failed');
    if (!data.length) return;
    const { error: removeError } = await bucket.remove(
      data.map((object) => `${userId}/${object.name}`),
    );
    if (removeError) throw new Error('Photo cleanup failed');
  }
  throw new Error('Photo cleanup incomplete; retry account deletion');
}
