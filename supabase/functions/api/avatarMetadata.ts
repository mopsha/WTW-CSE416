import type { AvatarChange } from '../_shared/api/avatars.ts';
import { createServiceClient } from './serviceClient.ts';

/** A single batched projection per response; no N+1 identity lookups. */
export async function avatarMetadata(
  viewerId: string,
  userIds: string[],
): Promise<Record<string, AvatarChange>> {
  if (!userIds.length) return {};
  try {
    const { data, error } = await createServiceClient().rpc('avatar_refs', {
      p_viewer_id: viewerId,
      p_target_ids: [...new Set(userIds)],
    });
    if (error) throw new Error('Photo metadata unavailable');
    return data as Record<string, AvatarChange>;
  } catch {
    // Optional photo enrichment must not break onboarding, profile edits, or
    // messaging after their canonical operation already succeeded. Photo reads
    // remain separately authorized and fail closed. Never log database details.
    console.warn('Photo metadata unavailable');
    return {};
  }
}
