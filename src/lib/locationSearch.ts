// "Where are we going?" search for Create Pick.
// Mock mode searches a fixed list near SBU. Real mode uses the phone's own geocoder
// (expo-location), which needs no API key but is not true autocomplete and does not
// work on web. TODO(Alan/Josh): swap for a server-side GET /places/autocomplete so the
// Google key never ships in the app.
import * as Location from 'expo-location';

import type { LatLng } from '@shared/domain/geo.ts';

import { USE_MOCK } from './config';

export interface LocationResult {
  id: string;
  label: string;
  detail: string;
  center: LatLng;
}

const MOCK_LOCATIONS: readonly LocationResult[] = [
  ['SBU Academic Mall', 'Stony Brook University', 40.9126, -73.1234],
  ['SBU Student Activities Center', 'Stony Brook University', 40.9145, -73.1243],
  ['Stony Brook Village Center', 'Stony Brook, NY', 40.9178, -73.1462],
  ['Port Jefferson Village', 'Port Jefferson, NY', 40.9465, -73.0693],
  ['East Setauket', 'Setauket, NY', 40.9387, -73.0979],
  ['Smith Haven Mall', 'Lake Grove, NY', 40.8668, -73.1336],
  ['Centereach', 'Centereach, NY', 40.8584, -73.0996],
  ['Smithtown', 'Smithtown, NY', 40.8559, -73.2007],
].map(([label, detail, lat, lng], i) => ({
  id: `mock-loc-${i}`,
  label: label as string,
  detail: detail as string,
  center: { lat: lat as number, lng: lng as number },
}));

/** Where the map starts before we know anything (SBU Academic Mall). */
export const DEFAULT_CENTER: LatLng = MOCK_LOCATIONS[0]!.center;

export async function searchLocations(query: string): Promise<LocationResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 150));
    const needle = q.toLowerCase();
    return MOCK_LOCATIONS.filter((l) =>
      `${l.label} ${l.detail}`.toLowerCase().includes(needle),
    ).slice(0, 5);
  }

  // The geocoder only returns coordinates, so name each hit ("Springfield" / "Illinois, US")
  // or five Springfields look the same and the form shows whatever was typed.
  const hits = (await Location.geocodeAsync(q)).slice(0, 5);
  const named = await Promise.all(
    hits.map(async (h) => {
      const center = { lat: h.latitude, lng: h.longitude };
      const place = await Location.reverseGeocodeAsync({
        latitude: h.latitude,
        longitude: h.longitude,
      })
        .then((r) => r[0])
        .catch(() => undefined);
      return { center, ...placeLabel(place, q) };
    }),
  );
  const seen = new Set<string>();
  return named
    .filter(({ label, detail }) => {
      const key = `${label}|${detail}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((r) => ({ ...r, id: `geo-${r.center.lat.toFixed(5)},${r.center.lng.toFixed(5)}` }));
}

/** "Springfield" / "Illinois, United States" from a reverse-geocoded address. */
export function placeLabel(
  place: Partial<Location.LocationGeocodedAddress> | undefined,
  query: string,
): { label: string; detail: string } {
  const label = place?.city || place?.district || place?.name || place?.subregion || query;
  const detail = [place?.region, place?.country]
    .filter((part): part is string => !!part && part !== label)
    .join(', ');
  return { label, detail: detail || 'Nearby area' };
}

/**
 * The device's current position, or null if the user says no.
 * Throws only for real failures (location services off, timeout).
 */
export async function currentLocation(): Promise<LatLng | null> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== Location.PermissionStatus.GRANTED) return null;
  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  return { lat: pos.coords.latitude, lng: pos.coords.longitude };
}
