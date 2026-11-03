import { ApiError } from '../_shared/api/errors.ts';
import type { UserProfile, UserProfilesStore } from '../_shared/api/userProfiles.ts';
import { createServiceClient } from './serviceClient.ts';
export function createUserProfilesStore(): UserProfilesStore {
  async function rpc(name: string, args: Record<string, unknown>): Promise<UserProfile> {
    const { data, error } = await createServiceClient().rpc(name, args);
    if (error) {
      if (error.code === 'PT404') throw new ApiError(404, 'PROFILE_NOT_FOUND', 'Profile not found');
      if (error.code === '23505')
        throw new ApiError(409, 'USERNAME_TAKEN', 'That username is already taken');
      if (error.code === 'PT400')
        throw new ApiError(400, 'INVALID_INPUT', 'Invalid profile details');
      if (error.code === 'PGRST202')
        throw new ApiError(503, 'DATABASE_NOT_READY', 'Profile details are not installed');
      throw new Error('Profile operation failed');
    }
    return data as UserProfile;
  }
  return {
    completeIdentity: (user, input) =>
      rpc('user_identity_update', { p_user_id: user, p_input: input }),
    get: (viewer, target) => rpc('user_profile_get', { p_viewer_id: viewer, p_target_id: target }),
    update: (user, input) => rpc('user_profile_update', { p_user_id: user, p_input: input }),
  };
}
