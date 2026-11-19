// "Where are we going?" search for Create Pick.
// Mock mode searches a fixed list near SBU. Real mode uses the phone's own geocoder
// (expo-location), which needs no API key but is not true autocomplete and does not
// work on web. TODO(Alan/Josh): swap for a server-side GET /places/autocomplete so the
// Google key never ships in the app.
import * as Location from 'expo-location';

import { distanceMeters, type LatLng } from '@shared/domain/geo.ts';

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

// Hits closer than this are the same place; the geocoder often returns near-duplicates.
const SAME_PLACE_M = 150;
// Reverse lookups are rate limited on iOS, so remember answers and name one hit at a time.
const named = new Map<string, Promise<Partial<Location.LocationGeocodedAddress> | undefined>>();

interface SearchOptions {
  /** Called as each hit gets its name. Without it, the search waits for every name. */
  onUpdate?: (results: LocationResult[]) => void;
  /** False once the user has typed past this search; naming stops there. */
  isCurrent?: () => boolean;
}

export async function searchLocations(
  query: string,
  { onUpdate, isCurrent = () => true }: SearchOptions = {},
): Promise<LocationResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 150));
    const needle = q.toLowerCase();
    return MOCK_LOCATIONS.filter((l) =>
      `${l.label} ${l.detail}`.toLowerCase().includes(needle),
    ).slice(0, 5);
  }

  const centers: LatLng[] = [];
  for (const h of await Location.geocodeAsync(q)) {
    const center = { lat: h.latitude, lng: h.longitude };
    if (centers.every((c) => distanceMeters(c, center) > SAME_PLACE_M)) centers.push(center);
    if (centers.length === 5) break;
  }
  // The geocoder only returns coordinates. Show the hits now and fill in each name
  // ("Springfield" / "Illinois, United States") as it arrives.
  let results: LocationResult[] = centers.map((center) => ({
    id: `geo-${center.lat.toFixed(5)},${center.lng.toFixed(5)}`,
    center,
    label: q,
    detail: 'Finding the area…',
  }));
  const naming = (async () => {
    for (const [i, r] of results.entries()) {
      if (!isCurrent()) return;
      const place = await reverseGeocode(r.center);
      results = results.map((old, j) => (j === i ? { ...old, ...placeLabel(place, q) } : old));
      if (isCurrent()) onUpdate?.(results);
    }
  })();
  if (!onUpdate) await naming;
  return results;
}

function reverseGeocode(center: LatLng) {
  const key = `${center.lat.toFixed(4)},${center.lng.toFixed(4)}`;
  let place = named.get(key);
  if (!place) {
    place = Location.reverseGeocodeAsync({ latitude: center.lat, longitude: center.lng })
      .then((r) => r[0])
      .catch(() => {
        named.delete(key);
        return undefined;
      });
    if (named.size >= 100) named.delete(named.keys().next().value!);
    named.set(key, place);
  }
  return place;
}

// Most to least specific. The label is the most specific part the user typed (a street, a
// neighborhood, a city), and the detail is the next two broader parts.
const PARTS = ['name', 'district', 'city', 'subregion', 'region', 'country'] as const;

/** "Springfield" / "Illinois, United States" from a reverse-geocoded address. */
export function placeLabel(
  place: Partial<Location.LocationGeocodedAddress> | undefined,
  query: string,
): { label: string; detail: string } {
  const words = query
    .toLowerCase()
    .split(/[\s,]+/)
    .filter((w) => w.length >= 2);
  const parts = PARTS.map((key) => place?.[key] ?? null);
  const typed = parts.findIndex(
    (part) => !!part && words.some((w) => part.toLowerCase().includes(w)),
  );
  const at = typed >= 0 ? typed : ([2, 1, 0, 3].find((i) => !!parts[i]) ?? -1);
  const label = at >= 0 ? parts[at]! : query;
  const detail = [
    ...new Set(
      parts
        .slice(at + 1)
        .filter((part, i): part is string => !!part && part !== label && at + 1 + i !== 3),
    ),
  ]
    .slice(0, 2)
    .join(', ');
  return { label, detail: detail || 'Nearby area' };
}

/** What the form shows once a result is chosen: "Springfield, Illinois". */
export function chosenLabel(result: LocationResult): string {
  const broader = result.detail.split(', ')[0];
  return broader && result.detail !== 'Nearby area' && result.detail !== 'Finding the area…'
    ? `${result.label}, ${broader}`
    : result.label;
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
