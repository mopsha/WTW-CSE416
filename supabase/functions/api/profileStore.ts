import type { ProfileStore } from '../_shared/api/profile.ts';
import { createServiceClient } from './serviceClient.ts';

/** Service-role adapter for public.profiles (0001_init.sql). Writes only the given id's row. */
export function createProfileStore(): ProfileStore {
  return {
    async setDisplayName(userId, displayName) {
      // Upsert: handle_new_user normally creates the row at sign-up, but an account made
      // before that trigger existed would otherwise be silently left without a name.
      const { error } = await createServiceClient()
        .from('profiles')
        .upsert(
          { id: userId, display_name: displayName, updated_at: new Date().toISOString() },
          { onConflict: 'id' },
        );
      if (error) throw new Error('Database operation failed');
    },
  };
}
