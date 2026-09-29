import type { LatLng } from '../domain/geo.ts';

export type Category = 'food' | 'activities';

/** Normalized provider place; placeId matches pick_candidates.place_id. */
export interface Candidate extends LatLng {
  placeId: string;
  name: string;
  category: Category;
}

export interface PlaceSearch {
  center: LatLng;
  radiusM: number;
  category?: Category;
}

export interface PlaceProvider {
  search(query: PlaceSearch): Promise<Candidate[]>;
}
