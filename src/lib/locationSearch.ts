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
  /** What the form shows once chosen, when it differs from the label. */
  chosen?: string;
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
const FINDING = 'Finding the area…';

interface SearchOptions {
  /** Gets the hits right away, then again as each one is named. */
  onUpdate?: (results: LocationResult[]) => void;
  /** False once the user has typed past this search; its lookups are skipped. */
  isCurrent?: () => boolean;
}

/** Resolves to the hits once all are named; with onUpdate, as soon as they're found. */
export async function searchLocations(
  query: string,
  { onUpdate, isCurrent = () => true }: SearchOptions = {},
): Promise<LocationResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 150));
    const needle = q.toLowerCase();
    const found = MOCK_LOCATIONS.filter((l) =>
      `${l.label} ${l.detail}`.toLowerCase().includes(needle),
    ).slice(0, 5);
    if (isCurrent()) onUpdate?.(found);
    return found;
  }

  const centers: LatLng[] = [];
  for (const h of await Location.geocodeAsync(q)) {
    const center = { lat: h.latitude, lng: h.longitude };
    if (centers.every((c) => distanceMeters(c, center) > SAME_PLACE_M)) centers.push(center);
    if (centers.length === 5) break;
  }
  // The geocoder only returns coordinates. Show the hits now and fill in each name
  // ("Springfield" / "Illinois, United States") as it arrives.
  const named: (NamedPlace | null)[] = centers.map(() => null);
  const show = () =>
    distinguish(
      centers.map((center, i) => ({
        id: `geo-${center.lat.toFixed(5)},${center.lng.toFixed(5)}`,
        center,
        ...(named[i] ?? { label: q, detail: FINDING, chosen: q, extras: [] }),
      })),
    );
  if (isCurrent()) onUpdate?.(show());
  const naming = (async () => {
    for (const [i, center] of centers.entries()) {
      const place = await reverseGeocode(center, isCurrent);
      if (place === SKIPPED) return;
      named[i] = describePlace(place, q);
      if (isCurrent()) onUpdate?.(show());
    }
  })();
  if (!onUpdate) await naming;
  return show();
}

type Address = Partial<Location.LocationGeocodedAddress>;
const SKIPPED = Symbol('skipped');
// iOS rate limits reverse lookups, so every search shares one line, one lookup at a time, and
// a search the user has typed past gives up its turn. Answers are remembered.
const answers = new Map<string, Address | undefined>();
let line: Promise<unknown> = Promise.resolve();

function reverseGeocode(
  center: LatLng,
  isCurrent: () => boolean,
): Promise<Address | undefined | typeof SKIPPED> {
  const key = `${center.lat.toFixed(4)},${center.lng.toFixed(4)}`;
  if (answers.has(key)) return Promise.resolve(answers.get(key));
  const turn = line.then(async () => {
    if (!isCurrent()) return SKIPPED;
    if (answers.has(key)) return answers.get(key);
    try {
      const [place] = await Location.reverseGeocodeAsync({
        latitude: center.lat,
        longitude: center.lng,
      });
      if (answers.size >= 100) answers.delete(answers.keys().next().value!);
      answers.set(key, place);
      return place;
    } catch {
      return undefined;
    }
  });
  line = turn;
  return turn;
}

interface NamedPlace {
  label: string;
  detail: string;
  /** What the form shows once chosen: "Springfield, Illinois". */
  chosen: string;
  /** Unused parts of the address, most specific first, to tell same-named places apart. */
  extras: string[];
}

// Most to least specific. The label is the most specific part the user typed (a street, a
// neighborhood, a city), and the detail is the next two broader parts.
const PARTS = ['name', 'district', 'city', 'subregion', 'region', 'country'] as const;

/** "Springfield" / "Illinois, United States" from a reverse-geocoded address. */
export function describePlace(place: Address | undefined, query: string): NamedPlace {
  const words = query
    .toLowerCase()
    .split(/[\s,]+/)
    .filter((w) => w.length >= 2);
  const parts = PARTS.map((key) => place?.[key] || null);
  const typed = parts.findIndex(
    (part) => !!part && words.some((w) => part.toLowerCase().includes(w)),
  );
  const at = typed >= 0 ? typed : ([2, 1, 0, 3].find((i) => !!parts[i]) ?? -1);
  const label = at >= 0 ? parts[at]! : query;
  const broader = [
    ...new Set(
      parts
        .slice(at + 1)
        .filter((part, i): part is string => !!part && part !== label && at + 1 + i !== 3),
    ),
  ];
  const detail = broader.slice(0, 2).join(', ') || 'Nearby area';
  // Keep the city (for a street or neighborhood) and the region; the country only without one.
  const city = at < 2 ? parts[2] : null;
  const region = parts[4] ?? (at < 5 ? parts[5] : null);
  const chosen = [...new Set([label, city, region].filter((p): p is string => !!p))].join(', ');
  const extras = [parts[1], parts[3], place?.postalCode, parts[0]].filter(
    (part): part is string => !!part && part !== label && !broader.slice(0, 2).includes(part),
  );
  return { label, detail, chosen, extras };
}

/** Same label and detail for different spots: lead the detail with what differs. */
function distinguish(results: (LocationResult & { extras: string[] })[]): LocationResult[] {
  const key = (r: LocationResult) => `${r.label}|${r.detail}`;
  return results.map(({ extras, ...r }, i) => {
    const twins = results.filter((o, j) => j !== i && o.detail !== FINDING && key(o) === key(r));
    if (r.detail === FINDING || !twins.length) return r;
    const differs = extras.find((e) => twins.every((t) => !t.extras.includes(e)));
    return differs ? { ...r, detail: `${differs} · ${r.detail}` } : r;
  });
}

/** What the form shows once a result is chosen: "Springfield, Illinois". */
export function chosenLabel(result: LocationResult): string {
  return result.chosen ?? result.label;
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
