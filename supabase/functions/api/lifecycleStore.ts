import fixtures from '../../seed/places.json' with { type: 'json' };
import type { Candidate } from '../_shared/places/types.ts';
import { ApiError, type ErrorStatus } from '../_shared/api/errors.ts';
import type { LifecycleStore, LifecyclePick } from '../_shared/api/lifecycle.ts';
import { createServiceClient } from './serviceClient.ts';

function mapRpcError(error: { code: string; message: string }): never {
  if (error.code === 'PGRST202') {
    throw new ApiError(
      503,
      'DATABASE_NOT_READY',
      'Pick lifecycle database integration is not installed',
    );
  }
  const statuses: Record<string, ErrorStatus> = { PT400: 400, PT403: 403, PT404: 404, PT409: 409 };
  const status = statuses[error.code];
  if (status) {
    const messages = {
      400: 'Invalid request',
      403: 'Pick access denied',
      404: 'Pick not found',
      409: 'Pick changed; reload before trying again',
    };
    throw new ApiError(
      status,
      status === 409 ? 'PICK_CONFLICT' : 'PICK_ACCESS_ERROR',
      messages[status as keyof typeof messages],
    );
  }
  throw new Error('Database operation failed');
}

/** Service-role adapter for the transactional RPCs in 0003_pick_lifecycle.sql. */
export function createLifecycleStore(): LifecycleStore {
  async function rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await createServiceClient().rpc(name, args);
    if (error) mapRpcError(error);
    return data;
  }
  return {
    async savedCandidates(hostId) {
      const client = createServiceClient();
      const { data: saved, error } = await client
        .from('saved_places')
        .select('place_id')
        .eq('user_id', hostId)
        .order('created_at')
        .order('place_id');
      if (error) throw new ApiError(503, 'SAVED_PLACES_UNAVAILABLE', 'Saved places unavailable');
      const ids = (saved ?? []).map((row) => row.place_id as string);
      const ownFixtures = new Map(
        fixtures.map((p) => [
          p.placeId,
          { ...p, provider: 'mock', retention: 'persistable' } as Candidate,
        ]),
      );
      const customIds = ids.filter((id) => id.startsWith('custom:'));
      if (customIds.length) {
        const { data, error: customError } = await client.rpc('saved_custom_candidates', {
          p_host_id: hostId,
        });
        if (customError || !Array.isArray(data))
          throw new ApiError(503, 'SAVED_PLACES_UNAVAILABLE', 'Saved custom places unavailable');
        for (const candidate of data as Candidate[]) ownFixtures.set(candidate.placeId, candidate);
      }
      // Google saves are ID-only. Do not invent display/coordinates or persist Google content.
      return ids.flatMap((id) => (ownFixtures.has(id) ? [ownFixtures.get(id)!] : []));
    },
    async createPick(hostId, input) {
      return (await rpc('pick_create_options', { p_host_id: hostId, p_input: input })) as {
        id: string;
      };
    },
    async load(pickId, userId) {
      return (await rpc('pick_load_options', {
        p_pick_id: pickId,
        p_user_id: userId,
      })) as LifecyclePick | null;
    },
    async start(pickId, userId, candidates) {
      await rpc('pick_start', { p_pick_id: pickId, p_user_id: userId, p_candidates: candidates });
    },
    async refresh(pickId, userId, candidates) {
      await rpc('pick_refresh', {
        p_pick_id: pickId,
        p_user_id: userId,
        p_candidates: candidates,
      });
    },
    async cancel(pickId, userId) {
      await rpc('pick_cancel', { p_pick_id: pickId, p_user_id: userId });
    },
  };
}
