import { createAvailabilityStore } from './availabilityStore.ts';
import { createGroupIdeasStore } from './groupIdeasStore.ts';
import fixtures from '../../seed/places.json' with { type: 'json' };
import type { Candidate } from '../_shared/places/types.ts';
import { ApiError, type ErrorStatus } from '../_shared/api/errors.ts';
import type { LifecycleStore, LifecyclePick } from '../_shared/api/lifecycle.ts';
import { memberTastesFrom } from '../_shared/domain/groupTaste.ts';
import { createTasteSigner } from '../_shared/api/tasteSignals.ts';
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
  let signer: ((message: string) => Promise<string>) | undefined;
  async function rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await createServiceClient().rpc(name, args);
    if (error) mapRpcError(error);
    return data;
  }
  return {
    availability: createAvailabilityStore(),
    groupIdeas: (groupId, hostId) => createGroupIdeasStore().list(hostId, groupId),
    candidateUuid: () => crypto.randomUUID(),
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
    async finalistIds(pickId) {
      const { data, error } = await createServiceClient()
        .from('ranking_results')
        .select('place_id')
        .eq('pick_id', pickId)
        .lte('rank', 3);
      if (error) mapRpcError(error);
      return ((data ?? []) as { place_id: string }[]).map((r) => r.place_id);
    },
    // Best effort: taste only orders the deck and breaks ties, so a failed read means none.
    async memberTastes(userIds) {
      const client = createServiceClient();
      const [profiles, learned] = await Promise.all([
        client.from('profiles').select('id, discover_preferences').in('id', userIds),
        client
          .from('learned_taste')
          .select('user_id, place_type, score, updated_at')
          .in('user_id', userIds),
      ]);
      if (profiles.error) return [];
      // Explicit answers still count if only the learned scores can't be read.
      const rows = learned.error ? [] : (learned.data ?? []);
      return memberTastesFrom(userIds, profiles.data ?? [], rows, new Date());
    },
    // Proofs for live Google types (tasteSignals.ts), keyed from a server-only secret read on
    // first use. Without one this throws, no proofs are issued, and Google swipes don't teach.
    async signTaste(message) {
      if (!signer) {
        const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        if (!secret) throw new Error('No signing secret');
        signer = createTasteSigner(secret);
      }
      return signer(message);
    },
    async recordGoogleTaste(userId, pickId, placeId, kind, type) {
      await rpc('taste_record_google_signal', {
        p_user_id: userId,
        p_pick_id: pickId,
        p_place_id: placeId,
        p_kind: kind,
        p_type: type,
      });
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
    async cancel(pickId, userId, reason) {
      await rpc('pick_cancel', { p_pick_id: pickId, p_user_id: userId, p_reason: reason });
    },
  };
}
