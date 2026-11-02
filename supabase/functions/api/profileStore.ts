import type { ProfileStore } from '../_shared/api/profile.ts';
import { createServiceClient } from './serviceClient.ts';

/**
 * Service-role adapter for public.profiles (0001_init.sql, survey columns in 0011).
 * Reads and writes only the given id's row.
 */
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

    async getProfile(userId) {
      const { data, error } = await createServiceClient()
        .from('profiles')
        .select('display_name, discover_preferences, preferences_updated_at')
        .eq('id', userId)
        .maybeSingle();
      if (error) throw new Error('Database operation failed');
      if (!data) return null;
      const row = data as {
        display_name: string | null;
        discover_preferences: unknown;
        preferences_updated_at: string | null;
      };
      return {
        displayName: row.display_name,
        preferences: row.discover_preferences,
        preferencesUpdatedAt: row.preferences_updated_at,
      };
    },

    async setPreferences(userId, preferences) {
      const now = new Date().toISOString();
      const { error } = await createServiceClient().from('profiles').upsert(
        {
          id: userId,
          discover_preferences: preferences,
          preferences_updated_at: now,
          updated_at: now,
        },
        { onConflict: 'id' },
      );
      if (error) throw new Error('Database operation failed');
    },
  };
}
