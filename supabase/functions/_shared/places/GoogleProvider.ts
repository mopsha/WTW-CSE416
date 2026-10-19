import type { OpeningHours, HoursPoint } from '../domain/openingHours.ts';
import { categoryMap, matchesCategory } from './categoryMap.ts';
import type { Candidate, Category, PlaceProvider, PlaceSearch } from './types.ts';
import type { HoursRecord } from './refreshOpenHours.ts';
import { withTimeout } from './timeout.ts';

export type HttpClient = (url: string, init: RequestInit) => Promise<Pick<Response, 'ok' | 'json'>>;
const FIELDS = [
  'id',
  'displayName',
  'formattedAddress',
  'location',
  'priceLevel',
  'rating',
  'types',
  'photos',
  'attributions',
  'googleMapsUri',
  'regularOpeningHours.periods',
  'businessStatus',
  'timeZone',
];
export const NEARBY_FIELD_MASK = FIELDS.map((f) => `places.${f}`).join(',');
const HOURS_MASK =
  'id,regularOpeningHours.periods,currentOpeningHours.openNow,currentOpeningHours.nextCloseTime,businessStatus,timeZone';
const record = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

function hoursPoint(v: unknown): HoursPoint | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const p = record(v);
  // Dated/truncated current-period data must not become a repeating weekly schedule.
  if (p.date !== undefined || p.truncated === true) return null;
  // Protobuf JSON may omit zero-valued hour/minute fields.
  const day = p.day ?? 0,
    hour = p.hour ?? 0,
    minute = p.minute ?? 0;
  if (
    !v ||
    ![day, hour, minute].every(Number.isInteger) ||
    Number(day) < 0 ||
    Number(day) > 6 ||
    Number(hour) < 0 ||
    Number(hour) > 23 ||
    Number(minute) < 0 ||
    Number(minute) > 59
  )
    return null;
  return { day: Number(day), hour: Number(hour), minute: Number(minute) };
}

export function normalizeHours(value: unknown, businessStatus?: unknown): OpeningHours | null {
  if (businessStatus === 'CLOSED_PERMANENTLY' || businessStatus === 'CLOSED_TEMPORARILY') {
    return { periods: [], closed: true };
  }
  const raw = record(value).periods;
  if (!Array.isArray(raw)) return null;
  const periods: OpeningHours['periods'] = [];
  for (const entry of raw) {
    const p = record(entry),
      open = hoursPoint(p.open),
      close = hoursPoint(p.close);
    if (!open) return null;
    if (
      p.close === undefined &&
      raw.length === 1 &&
      open.day === 0 &&
      open.hour === 0 &&
      open.minute === 0
    ) {
      return { periods: [], alwaysOpen: true };
    }
    if (
      !close ||
      (open.day === close.day && open.hour === close.hour && open.minute === close.minute)
    )
      return null;
    periods.push({ open, close });
  }
  return { periods };
}

export function normalizePlace(
  value: unknown,
  category: Category,
  fetchedAt: string,
): Candidate | null {
  const p = record(value),
    location = record(p.location);
  const placeId = str(p.id),
    name = str(record(p.displayName).text);
  const types = strings(p.types);
  if (
    !placeId ||
    placeId.length > 256 ||
    !name ||
    !finite(location.latitude) ||
    !finite(location.longitude) ||
    Math.abs(location.latitude) > 90 ||
    Math.abs(location.longitude) > 180 ||
    !matchesCategory(types, category)
  )
    return null;
  if (p.businessStatus === 'CLOSED_PERMANENTLY' || p.businessStatus === 'CLOSED_TEMPORARILY')
    return null;
  const prices: Record<string, number> = {
    PRICE_LEVEL_FREE: 0,
    PRICE_LEVEL_INEXPENSIVE: 1,
    PRICE_LEVEL_MODERATE: 2,
    PRICE_LEVEL_EXPENSIVE: 3,
    PRICE_LEVEL_VERY_EXPENSIVE: 4,
  };
  const photos = (Array.isArray(p.photos) ? p.photos : []).flatMap((value) => {
    const photo = record(value),
      name = str(photo.name);
    if (!name) return [];
    return [
      {
        name,
        authorAttributions: (Array.isArray(photo.authorAttributions)
          ? photo.authorAttributions
          : []
        ).flatMap((value) => {
          const author = record(value),
            displayName = str(author.displayName);
          return displayName ? [{ displayName, uri: str(author.uri) }] : [];
        }),
      },
    ];
  });
  return {
    placeId,
    name,
    category,
    lat: location.latitude,
    lng: location.longitude,
    address: str(p.formattedAddress),
    types,
    photos,
    priceLevel: prices[String(p.priceLevel)] ?? null,
    rating: finite(p.rating) && p.rating >= 0 && p.rating <= 5 ? p.rating : null,
    openingHours: normalizeHours(p.regularOpeningHours, p.businessStatus),
    timezone: str(record(p.timeZone).id),
    googleMapsUri: str(p.googleMapsUri),
    attributions: (Array.isArray(p.attributions) ? p.attributions : []).flatMap((value) => {
      const a = record(value),
        provider = str(a.provider);
      return provider ? [{ provider, providerUri: str(a.providerUri) }] : [];
    }),
    provider: 'google',
    fetchedAt,
    retention: 'request',
  };
}

export function validateSearch(query: PlaceSearch): void {
  if (
    !Number.isFinite(query.center.lat) ||
    Math.abs(query.center.lat) > 90 ||
    !Number.isFinite(query.center.lng) ||
    Math.abs(query.center.lng) > 180 ||
    !Number.isFinite(query.radiusM) ||
    query.radiusM < 0 ||
    query.radiusM > 50_000 ||
    (query.category !== undefined && query.category !== 'food' && query.category !== 'activities')
  ) {
    throw new RangeError('Invalid Places search');
  }
}

/** Request-scoped Google content. Credentials and provider response errors never leave this adapter. */
export class GoogleProvider implements PlaceProvider {
  constructor(
    private readonly apiKey: string,
    private readonly http: HttpClient = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (!apiKey.trim()) throw new Error('Google Places is not configured');
  }

  private async request(
    path: string,
    mask: string,
    init: RequestInit,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return withTimeout(
      async (boundedSignal) => {
        try {
          const response = await this.http(`https://places.googleapis.com/v1/${path}`, {
            ...init,
            signal: boundedSignal,
            headers: {
              'Content-Type': 'application/json',
              'X-Goog-Api-Key': this.apiKey,
              'X-Goog-FieldMask': mask,
            },
          });
          if (!response.ok) throw new Error();
          return await response.json();
        } catch {
          throw new Error('Google Places request failed');
        }
      },
      3000,
      signal,
    );
  }

  async search(query: PlaceSearch, options?: { signal?: AbortSignal }): Promise<Candidate[]> {
    validateSearch(query);
    const types = query.category
      ? categoryMap[query.category]
      : [...categoryMap.food, ...categoryMap.activities];
    const result = record(
      await this.request(
        'places:searchNearby',
        NEARBY_FIELD_MASK,
        {
          method: 'POST',
          body: JSON.stringify({
            includedTypes: types,
            maxResultCount: 20,
            rankPreference: 'DISTANCE',
            locationRestriction: {
              circle: {
                center: { latitude: query.center.lat, longitude: query.center.lng },
                radius: query.radiusM,
              },
            },
          }),
        },
        options?.signal,
      ),
    );
    if (result.places === undefined) return [];
    if (!Array.isArray(result.places)) throw new Error('Invalid Google Places response');
    const fetchedAt = this.now().toISOString();
    return result.places.flatMap((value) => {
      const category =
        query.category ??
        (matchesCategory(strings(record(value).types), 'food') ? 'food' : 'activities');
      const candidate = normalizePlace(value, category, fetchedAt);
      return candidate ? [candidate] : [];
    });
  }

  async fetchHours(placeId: string, options?: { signal?: AbortSignal }): Promise<HoursRecord> {
    if (!placeId.trim() || placeId.length > 256) throw new Error('Invalid place ID');
    const p = record(
      await this.request(
        `places/${encodeURIComponent(placeId)}`,
        HOURS_MASK,
        { method: 'GET' },
        options?.signal,
      ),
    );
    if (p.id !== placeId) throw new Error('Invalid Google hours response');
    const current = record(p.currentOpeningHours);
    return {
      placeId,
      provider: 'google',
      fetchedAt: this.now().toISOString(),
      openingHours: normalizeHours(p.regularOpeningHours, p.businessStatus),
      timezone: str(record(p.timeZone).id),
      currentOpenNow: typeof current.openNow === 'boolean' ? current.openNow : undefined,
      currentClosesAt: str(current.nextCloseTime),
    };
  }
}
