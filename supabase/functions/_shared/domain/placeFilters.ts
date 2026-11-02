import { isOpenAt } from './openingHours.ts';
import type { Candidate } from '../places/types.ts';

export interface PlaceFilters {
  priceMax?: number | null;
  openNow?: boolean;
}

export function validFilters(value: PlaceFilters): boolean {
  return (
    (value.priceMax == null ||
      (Number.isInteger(value.priceMax) && value.priceMax >= 0 && value.priceMax <= 4)) &&
    (value.openNow === undefined || typeof value.openNow === 'boolean')
  );
}

/** Unknown price/hours cannot satisfy an explicitly requested constraint. */
export function matchesFilters(place: Candidate, filters: PlaceFilters, now: Date): boolean {
  return (
    (filters.priceMax == null ||
      (place.priceLevel != null && place.priceLevel <= filters.priceMax)) &&
    (!filters.openNow || isOpenAt(place.openingHours, now, place.timezone ?? '') === true)
  );
}
