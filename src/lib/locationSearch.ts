// "Where are we going?" search for Create Pick.
// Mock mode searches a fixed list near SBU. Real mode uses the phone's own geocoder
// (expo-location), which needs no API key but is not true autocomplete and does not
// work on web. TODO(Alan/Josh): swap for a server-side GET /places/autocomplete so the
// Google key never ships in the app.
import * as Location from 'expo-location';
import { Platform } from 'react-native';

import { distanceMeters, type LatLng } from '@shared/domain/geo.ts';

import { USE_MOCK } from './config';
import { MOCK_LOCATIONS } from './mock/locations';

export interface LocationResult {
  id: string;
  label: string;
  detail: string;
  center: LatLng;
  /** What the form shows once chosen, when it differs from the label. */
  chosen?: string;
}

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
  const named = centers.map((center) => {
    const key = addressKey(center);
    return answers.has(key) ? describePlace(answers.get(key), q) : null;
  });
  const show = () =>
    distinguish(
      centers.map((center, i) => {
        const place = named[i];
        return {
          id: `geo-${center.lat.toFixed(5)},${center.lng.toFixed(5)}`,
          center,
          label: place?.label ?? q,
          detail: place?.detail ?? FINDING,
          extras: place?.extras ?? [],
          chosen: place?.chosen || coordinateLabel(center),
        };
      }),
    );
  if (isCurrent()) onUpdate?.(show());
  const naming = (async () => {
    for (const [i, center] of centers.entries()) {
      if (!isCurrent()) return;
      if (named[i]) continue;
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
const REVERSE_TIMEOUT_MS = 2500;
const answers = new Map<string, Address | undefined>();
let line: Promise<unknown> = Promise.resolve();
let nativeBusy = false;

function addressKey(center: LatLng) {
  return `${center.lat.toFixed(4)},${center.lng.toFixed(4)}`;
}

function coordinateLabel(center: LatLng) {
  return `${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}`;
}

function reverseGeocode(
  center: LatLng,
  isCurrent: () => boolean,
): Promise<Address | undefined | typeof SKIPPED> {
  const key = addressKey(center);
  if (!isCurrent()) return Promise.resolve(SKIPPED);
  if (answers.has(key)) return Promise.resolve(answers.get(key));
  const turn = line.then(async () => {
    if (!isCurrent()) return SKIPPED;
    if (answers.has(key)) return answers.get(key);
    // Expo does not expose native cancellation. Time out the queue turn, but keep
    // the native slot until the actual call settles. Cache misses use coordinates
    // while that slot is occupied, so slow calls cannot pile up in the background.
    if (nativeBusy) return undefined;
    nativeBusy = true;
    const native = Promise.resolve()
      .then(() => Location.reverseGeocodeAsync({ latitude: center.lat, longitude: center.lng }))
      .then(
        (places) => ({ place: places[0] }),
        () => undefined,
      )
      .finally(() => {
        nativeBusy = false;
      });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<undefined>((resolve) => {
      timer = setTimeout(resolve, REVERSE_TIMEOUT_MS);
    });
    const answer = await Promise.race([native, timeout]);
    clearTimeout(timer);
    if (!answer) return undefined;
    if (answers.size >= 100) answers.delete(answers.keys().next().value!);
    answers.set(key, answer.place);
    return answer.place;
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
  const city = parts[2];
  const region = parts[4] ?? (at < 5 ? parts[5] : null);
  const chosen = [
    ...new Set([at >= 0 ? label : null, city, region].filter((p): p is string => !!p)),
  ].join(', ');
  const extras = [parts[1], parts[3], place?.postalCode, parts[0], place?.street].filter(
    (part): part is string => !!part && part !== label && !broader.slice(0, 2).includes(part),
  );
  return { label, detail, chosen, extras };
}

/** Same label and detail for different spots: lead the detail with what differs. */
function distinguish(results: (LocationResult & { extras: string[] })[]): LocationResult[] {
  const key = (r: LocationResult) => `${r.label}|${r.detail}`;
  return results.map(({ extras, ...r }, i) => {
    const twins = results.filter((o, j) => j !== i && key(o) === key(r));
    const coords = coordinateLabel(r.center);
    if (!twins.length && r.chosen !== coords) return r;
    const differs = extras.find((e) => twins.every((t) => !t.extras.includes(e))) ?? coords;
    return {
      ...r,
      detail: `${differs} · ${r.detail}`,
      chosen: r.chosen === coords ? coords : `${r.chosen} · ${differs}`,
    };
  });
}

/** What the form shows once a result is chosen: "Springfield, Illinois". */
export function chosenLabel(result: LocationResult): string {
  return result.chosen ?? result.label;
}

/**
 * Where the phone last was, only if the user already allowed location. Never prompts, so
 * opening New Pick doesn't ask; it just starts near them instead of at a fixed default.
 */
export async function knownLocation(): Promise<LatLng | null> {
  if (USE_MOCK) return null;
  const { status } = await Location.getForegroundPermissionsAsync();
  if (status !== Location.PermissionStatus.GRANTED) return null;
  const pos = await Location.getLastKnownPositionAsync({ maxAge: 30 * 60_000 });
  return pos ? { lat: pos.coords.latitude, lng: pos.coords.longitude } : null;
}

async function locationTimeout<T>(work: Promise<T>, timeoutMs?: number): Promise<T> {
  if (timeoutMs === undefined) return work;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Location request timed out')), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The device's current position, or null if the user says no.
 * Throws only for real failures (location services off, timeout).
 * With `prompt: false` it only reads the permission and never shows the system prompt, and a
 * recent last-known fix is used first so screens like Discover don't wait for a new one.
 */
export async function currentLocation({
  prompt = true,
  timeoutMs,
}: { prompt?: boolean; timeoutMs?: number } = {}): Promise<LatLng | null> {
  if (prompt) {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== Location.PermissionStatus.GRANTED) return null;
    // Give the user time to answer the system permission dialog.
    return locationTimeout(devicePosition(), timeoutMs);
  }

  let expired = false;
  try {
    return await locationTimeout(
      (async () => {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (expired || status !== Location.PermissionStatus.GRANTED) return null;
        const last = await Location.getLastKnownPositionAsync({
          maxAge: 10 * 60_000,
          requiredAccuracy: 1000,
        });
        if (expired) return null;
        return devicePosition(last);
      })(),
      timeoutMs,
    );
  } finally {
    expired = true;
  }
}

async function devicePosition(last?: Location.LocationObject | null): Promise<LatLng> {
  const pos =
    last ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
  return { lat: pos.coords.latitude, lng: pos.coords.longitude };
}

/** A short area name ("Port Jefferson") for a point, or null. Native only; never throws. */
export async function areaName(center: LatLng): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    // Shares the reverse-geocode queue, 2.5 s timeout and cache with city search (#79):
    // iOS throttles overlapping lookups.
    const hit = await reverseGeocode(center, () => true);
    if (!hit || hit === SKIPPED) return null;
    return hit.city?.trim() || hit.district?.trim() || hit.subregion?.trim() || null;
  } catch {
    return null;
  }
}
