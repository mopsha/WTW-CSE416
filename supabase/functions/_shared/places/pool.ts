import { distanceMeters, type LatLng } from '../domain/geo.ts';
import type { Candidate, Category, PlaceProvider } from './types.ts';

export interface PoolRequest {
  center: LatLng;
  radiusM: number;
  category: Category;
  poolSize: number;
}

export interface PoolBuilder {
  buildPool(request: PoolRequest): Promise<Candidate[]>;
}

/**
 * Wrap any PlaceProvider into the pool-building contract Alan's lifecycle
 * routes depend on: dedupe, sort nearest-first, cap at poolSize.
 *
 * Josh's real buildPool (Google Places + place_cache, Week 2) implements the
 * same PoolBuilder interface, so swapping it in needs no change on this side;
 * until then, wrap MockProvider so start/refresh work end to end.
 */
export function createPoolBuilder(provider: PlaceProvider): PoolBuilder {
  return {
    async buildPool({ center, radiusM, category, poolSize }) {
      if (!Number.isInteger(poolSize) || poolSize < 1) {
        throw new RangeError(`poolSize must be a positive integer, got ${poolSize}`);
      }
      const found = await provider.search({ center, radiusM, category });
      const byId = new Map(found.map((c) => [c.placeId, c]));
      return [...byId.values()]
        .sort((a, b) => distanceMeters(center, a) - distanceMeters(center, b))
        .slice(0, poolSize);
    },
  };
}
