import type { LatLng } from '../domain/geo.ts';
import type { OpeningHours } from '../domain/openingHours.ts';

export type Category = 'food' | 'activities';

/** Normalized provider place; placeId matches pick_candidates.place_id. */
export interface Candidate extends LatLng {
  placeId: string;
  name: string;
  category: Category;
  address?: string;
  priceLevel?: number | null;
  rating?: number | null;
  types?: string[];
  photos?: { name: string; authorAttributions: { displayName: string; uri?: string }[] }[];
  attributions?: { provider: string; providerUri?: string }[];
  googleMapsUri?: string;
  openingHours?: OpeningHours | null;
  timezone?: string;
  provider?: 'google' | 'mock';
  fetchedAt?: string;
  /** Google content is for this response only; never serialize it into Pick snapshots. */
  retention?: 'request' | 'persistable';
}

export interface PlaceSearch {
  center: LatLng;
  radiusM: number;
  category?: Category;
}

export interface PlaceProvider {
  search(query: PlaceSearch, options?: { signal?: AbortSignal }): Promise<Candidate[]>;
}
