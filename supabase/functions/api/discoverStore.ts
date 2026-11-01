import type { DiscoverPreferences } from '../_shared/domain/discoverScore.ts';
import { ApiError } from '../_shared/api/errors.ts';
import { createServiceClient } from './serviceClient.ts';

export function createDiscoverStore() {
  return {
    async preferences(userId: string): Promise<DiscoverPreferences> {
      const { data, error } = await createServiceClient()
        .from('profiles')
        .select('discover_preferences')
        .eq('id', userId)
        .maybeSingle();
      if (error) throw new ApiError(503, 'DATABASE_NOT_READY', 'Discover preferences unavailable');
      // Profile editing belongs to FR-02. Treat malformed/legacy optional fields as absent.
      const raw = data?.discover_preferences ?? {};
      return {
        categories: Array.isArray(raw.categories)
          ? raw.categories.filter((v: unknown) => typeof v === 'string')
          : [],
        types: Array.isArray(raw.types)
          ? raw.types.filter((v: unknown) => typeof v === 'string')
          : [],
        priceMax:
          Number.isInteger(raw.priceMax) && raw.priceMax >= 0 && raw.priceMax <= 4
            ? raw.priceMax
            : null,
      };
    },
    async saved(userId: string) {
      const { data, error } = await createServiceClient()
        .from('saved_places')
        .select('place_id,created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .order('place_id');
      if (error) throw new ApiError(503, 'DATABASE_NOT_READY', 'Saved places unavailable');
      return (data ?? []).map((row) => ({ placeId: row.place_id, createdAt: row.created_at }));
    },
    async save(userId: string, placeId: string) {
      const { error } = await createServiceClient()
        .from('saved_places')
        .upsert(
          { user_id: userId, place_id: placeId },
          { onConflict: 'user_id,place_id', ignoreDuplicates: true },
        );
      if (error) throw new ApiError(503, 'DATABASE_NOT_READY', 'Could not save place');
    },
    async remove(userId: string, placeId: string) {
      const { error } = await createServiceClient()
        .from('saved_places')
        .delete()
        .eq('user_id', userId)
        .eq('place_id', placeId);
      if (error) throw new ApiError(503, 'DATABASE_NOT_READY', 'Could not remove place');
    },
  };
}
