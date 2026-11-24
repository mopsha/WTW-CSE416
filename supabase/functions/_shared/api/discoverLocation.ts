import type { LatLng } from '../domain/geo.ts';
import { ApiError } from './errors.ts';

export interface DiscoverLocationSuggestion {
  id: string;
  label: string;
  detail: string;
}

export interface ResolvedDiscoverLocation {
  id: string;
  label: string;
  center: LatLng;
  attributions?: { provider: string; providerUri?: string }[];
}

export const MAX_LOCATION_QUERY = 160;
export const MAX_LOCATION_SUGGESTIONS = 5;

export function validDiscoverLocationId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(value);
}

export function parseLocationQuery(body: unknown): string {
  const value = (body as { query?: unknown } | null)?.query;
  if (
    typeof value === 'string' &&
    value.length <= MAX_LOCATION_QUERY &&
    !/[\u0000-\u001f\u007f]/.test(value)
  ) {
    const query = value.trim().replace(/\s+/g, ' ');
    if (query.length >= 2) return query;
  }
  throw new ApiError(400, 'INVALID_INPUT', 'Enter a city, neighborhood, or address');
}
