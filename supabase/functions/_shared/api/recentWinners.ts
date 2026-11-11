import { ApiError } from './errors.ts';
import type { Candidate, Category } from '../places/types.ts';

export interface RecentWinner {
  pickId: string;
  placeId: string;
  snapshot: { provider?: string; category?: Category | 'custom' };
}
export interface RecentWinnersStore {
  /** One participant-scoped query, exact persisted winner FK, completed Picks only. */
  load(userId: string, pickIds: string[]): Promise<RecentWinner[]>;
}
export interface WinnerDisplay {
  pickId: string;
  placeId: string;
  name: string;
  provider: 'google';
  googleMapsUri?: string;
  attributions?: Candidate['attributions'];
}
export function parseRecentWinnerIds(body: unknown): string[] {
  const ids = (body as { pickIds?: unknown } | null)?.pickIds;
  if (
    !Array.isArray(ids) ||
    ids.length < 1 ||
    ids.length > 5 ||
    ids.some(
      (id) =>
        typeof id !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
    )
  ) {
    throw new ApiError(400, 'INVALID_INPUT', 'Choose up to five Picks');
  }
  return [...new Set(ids)];
}
/** Live content only. No writes, searches, photos, retries, or replacement winner selection. */
export async function resolveRecentWinners(
  store: RecentWinnersStore,
  userId: string,
  pickIds: string[],
  details: (placeId: string, category: Category) => Promise<Candidate | null>,
): Promise<WinnerDisplay[]> {
  const winners = await store.load(userId, pickIds);
  const found = new Map<string, Promise<Candidate | null>>();
  return (
    await Promise.all(
      winners.slice(0, 5).map(async (winner) => {
        if (!pickIds.includes(winner.pickId) || winner.snapshot.provider !== 'google') return [];
        if (!found.has(winner.placeId)) {
          found.set(
            winner.placeId,
            Promise.resolve()
              .then(() =>
                details(
                  winner.placeId,
                  winner.snapshot.category === 'activities' ? 'activities' : 'food',
                ),
              )
              .catch(() => null),
          );
        }
        const place = await found.get(winner.placeId);
        if (!place || place.placeId !== winner.placeId || !place.name?.trim()) return [];
        return [
          {
            pickId: winner.pickId,
            placeId: winner.placeId,
            name: place.name,
            provider: 'google' as const,
            googleMapsUri: place.googleMapsUri,
            attributions: place.attributions ?? [],
          },
        ];
      }),
    )
  ).flat();
}
