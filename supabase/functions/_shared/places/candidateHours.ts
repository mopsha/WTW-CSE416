import type { CandidateSnapshot } from '../api/lifecycle.ts';
import type { OpeningHours } from '../domain/openingHours.ts';
import { refreshOpenHours, type HoursProvider, type HoursRecord } from './refreshOpenHours.ts';

/** Resolve by stored provenance, never by the currently selected discovery provider. */
export function createCandidateHours(google: HoursProvider) {
  return async (candidates: CandidateSnapshot[]) => {
    const unique = [...new Map(candidates.map((c) => [c.placeId, c])).values()];
    return (
      await Promise.all(
        unique.map(async ({ placeId, snapshot }) => {
          const s = snapshot as Record<string, unknown>;
          if (s.provider === 'google') {
            return refreshOpenHours([placeId], { mode: 'google', provider: google });
          }
          // Untagged legacy/demo data is unknown, not assumed to be Google or fresh mock data.
          const cached: HoursRecord | null =
            s.provider === 'mock' && typeof s.fetchedAt === 'string'
              ? {
                  placeId,
                  provider: 'mock',
                  fetchedAt: s.fetchedAt,
                  openingHours: (s.openingHours ?? null) as OpeningHours | null,
                  timezone: typeof s.timezone === 'string' ? s.timezone : undefined,
                }
              : null;
          return refreshOpenHours([placeId], {
            mode: 'mock',
            cache: { get: async () => cached, set: async () => {} },
            // No authoritative hours source exists for current fixtures.
            provider: {
              fetchHours: async () => {
                throw new Error('Hours unavailable');
              },
            },
          });
        }),
      )
    ).flat();
  };
}
