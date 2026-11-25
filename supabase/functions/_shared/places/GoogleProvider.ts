import {
  DISCOVER_PRICES,
  discoverSearchTypes,
  narrowsSearch,
  validDiscovery,
  type DiscoverConstraints,
} from '../domain/discoverFilters.ts';
import {
  MAX_LOCATION_SUGGESTIONS,
  validDiscoverLocationId,
  type DiscoverLocationSuggestion,
  type ResolvedDiscoverLocation,
} from '../api/discoverLocation.ts';
import { boundingBox, validCenter } from '../domain/geo.ts';
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
export const DISCOVER_FIELD_MASK = `${NEARBY_FIELD_MASK},places.userRatingCount`;
// Current hours include special-day overrides and are in the same Enterprise tier.
const DISCOVER_OPEN_NOW_FIELD_MASK = `${DISCOVER_FIELD_MASK},places.currentOpeningHours.openNow`;
/** Enough to show a Pick's place, without the fields Google bills at a higher tier. */
const PICK_FIELDS = [
  'id',
  'displayName',
  'formattedAddress',
  'location',
  'types',
  'photos',
  'attributions',
  'googleMapsUri',
  'businessStatus',
];
export const PICK_SEARCH_MASK = PICK_FIELDS.map((f) => `places.${f}`).join(',');
/** Undefined means the full set, which a Pick's price or open-now filter needs to work. */
export function pickSearchMask(filters: { priceMax?: number | null; openNow?: boolean }) {
  return filters.priceMax === undefined || filters.priceMax === null
    ? filters.openNow
      ? undefined
      : PICK_SEARCH_MASK
    : undefined;
}
const HOURS_MASK =
  'id,regularOpeningHours.periods,currentOpeningHours.openNow,currentOpeningHours.nextCloseTime,businessStatus,timeZone';
const record = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

// Business and point-of-interest predictions are unsuitable as geographic centers.
const CENTER_TYPES = new Set([
  'locality',
  'sublocality',
  'neighborhood',
  'postal_town',
  'postal_code',
  'administrative_area_level_1',
  'administrative_area_level_2',
  'administrative_area_level_3',
  'street_address',
  'premise',
  'subpremise',
  'route',
  'intersection',
]);

function isGeographicCenter(value: unknown): boolean {
  const types = strings(value);
  return (
    !types.includes('establishment') &&
    !types.includes('point_of_interest') &&
    types.some((type) => CENTER_TYPES.has(type) || /^sublocality_level_[1-5]$/.test(type))
  );
}

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
  allowedTypes?: readonly string[],
): Candidate | null {
  const p = record(value),
    location = record(p.location);
  const currentOpenNow = record(p.currentOpeningHours).openNow;
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
    !(allowedTypes ? types.some((t) => allowedTypes.includes(t)) : matchesCategory(types, category))
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
        googleMapsUri: str(photo.googleMapsUri),
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
    ...(p.userRatingCount !== undefined
      ? {
          userRatingCount:
            Number.isInteger(p.userRatingCount) && Number(p.userRatingCount) >= 0
              ? Number(p.userRatingCount)
              : null,
        }
      : {}),
    openingHours: normalizeHours(p.regularOpeningHours, p.businessStatus),
    ...(typeof currentOpenNow === 'boolean' ? { currentOpenNow } : {}),
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
    (query.category !== undefined &&
      query.category !== 'food' &&
      query.category !== 'activities') ||
    (query.discovery !== undefined && !validDiscovery(query.discovery, query.category))
  ) {
    throw new RangeError('Invalid Places search');
  }
}

/**
 * A categorical Text Search query that doesn't steer results: "restaurants" or "things to do"
 * when no type is selected, else the selected Google types in words ("bowling alley"), never
 * UI labels like "Sports". Activities never get a food word, since types come per category.
 */
export function textQuery(
  category: Category,
  filters: DiscoverConstraints,
  types: string[],
): string {
  const selected =
    category === 'food'
      ? filters.cuisines?.length || filters.foodTypes?.length
      : filters.activityTypes?.length;
  if (!selected || !types.length) return category === 'food' ? 'restaurants' : 'things to do';
  return types.map((t) => t.replace(/_/g, ' ')).join(' or ');
}

/**
 * Text Search (New) body for filters Nearby Search can't apply (price, rating), so
 * Google returns new matching places instead of us trimming the same popular ones. Text Search
 * takes one includedType and only a rectangular restriction; pool.ts trims to the circle.
 */
export function textSearchBody(query: PlaceSearch & { category: Category }, types: string[]) {
  const filters = query.discovery ?? {};
  const box = boundingBox(query.center, query.radiusM);
  const point = (p: { lat: number; lng: number }) => ({ latitude: p.lat, longitude: p.lng });
  return {
    textQuery: textQuery(query.category, filters, types),
    ...(types.length === 1 ? { includedType: types[0], strictTypeFiltering: true } : {}),
    pageSize: 20,
    rankPreference: filters.sort === 'nearest' ? 'DISTANCE' : 'RELEVANCE',
    locationRestriction: { rectangle: { low: point(box.low), high: point(box.high) } },
    ...(filters.prices?.length && query.category === 'food'
      ? {
          priceLevels: DISCOVER_PRICES.filter((o) => filters.prices!.includes(o.value)).map(
            (o) => o.google,
          ),
        }
      : {}),
    ...(filters.minRating ? { minRating: filters.minRating } : {}),
    // No openNow: it drops unknown-hours places before the local unverified fallback.
  };
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
    mask: string | null,
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
              ...(mask ? { 'X-Goog-FieldMask': mask } : {}),
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

  async suggestDiscoverLocations(
    query: string,
    signal?: AbortSignal,
  ): Promise<DiscoverLocationSuggestion[]> {
    const raw = record(
      await this.request(
        'places:autocomplete',
        'suggestions.placePrediction.placeId,suggestions.placePrediction.text.text,suggestions.placePrediction.structuredFormat.mainText.text,suggestions.placePrediction.structuredFormat.secondaryText.text,suggestions.placePrediction.types',
        { method: 'POST', body: JSON.stringify({ input: query }) },
        signal,
      ),
    );
    const suggestions = new Map<string, DiscoverLocationSuggestion>();
    for (const item of Array.isArray(raw.suggestions)
      ? raw.suggestions.slice(0, MAX_LOCATION_SUGGESTIONS)
      : []) {
      const prediction = record(record(item).placePrediction);
      const id = prediction.placeId;
      const format = record(prediction.structuredFormat);
      const full = str(record(prediction.text).text)?.trim();
      const label = str(record(format.mainText).text)?.trim() ?? full;
      const detail =
        str(record(format.secondaryText).text)?.trim() ?? (full !== label ? full : undefined);
      if (
        !validDiscoverLocationId(id) ||
        !isGeographicCenter(prediction.types) ||
        !label ||
        label.length > 256 ||
        (detail && detail.length > 512)
      )
        continue;
      if (!suggestions.has(id)) suggestions.set(id, { id, label, detail: detail ?? '' });
    }
    return [...suggestions.values()];
  }

  async resolveDiscoverLocation(
    id: string,
    signal?: AbortSignal,
  ): Promise<ResolvedDiscoverLocation | null> {
    if (!validDiscoverLocationId(id)) throw new Error('Invalid place ID');
    const place = record(
      await this.request(
        `places/${encodeURIComponent(id)}`,
        'id,formattedAddress,location,types,attributions',
        { method: 'GET' },
        signal,
      ),
    );
    const location = record(place.location);
    const { latitude, longitude } = location;
    const label = str(place.formattedAddress)?.trim();
    if (
      place.id !== id ||
      !isGeographicCenter(place.types) ||
      !label ||
      label.length > 512 ||
      !finite(latitude) ||
      !finite(longitude)
    )
      return null;
    const center = { lat: latitude === 0 ? 0 : latitude, lng: longitude === 0 ? 0 : longitude };
    if (!validCenter(center)) return null;
    const attributions = Array.isArray(place.attributions)
      ? place.attributions.flatMap((value) => {
          const { provider, providerUri } = record(value);
          const name = str(provider);
          const uri = str(providerUri);
          return name
            ? [{ provider: name, ...(uri?.startsWith('https://') ? { providerUri: uri } : {}) }]
            : [];
        })
      : [];
    return { id, label, center, ...(attributions.length ? { attributions } : {}) };
  }

  async search(
    query: PlaceSearch,
    options?: { signal?: AbortSignal; mask?: string },
  ): Promise<Candidate[]> {
    validateSearch(query);
    const types =
      query.discovery && query.category
        ? discoverSearchTypes(query.category, query.discovery)
        : query.category
          ? categoryMap[query.category]
          : [...categoryMap.food, ...categoryMap.activities];
    // Discover only; Picks never send discovery, so they keep Nearby Search.
    const text = !!query.category && narrowsSearch(query.discovery);
    const mask = query.discovery?.openNow
      ? DISCOVER_OPEN_NOW_FIELD_MASK
      : query.discovery
        ? DISCOVER_FIELD_MASK
        : NEARBY_FIELD_MASK;
    const result = record(
      await this.request(
        text ? 'places:searchText' : 'places:searchNearby',
        options?.mask ?? mask,
        {
          method: 'POST',
          body: JSON.stringify(
            text
              ? textSearchBody({ ...query, category: query.category! }, [...types])
              : {
                  includedTypes: types,
                  maxResultCount: 20,
                  rankPreference: query.discovery?.sort === 'nearest' ? 'DISTANCE' : 'POPULARITY',
                  locationRestriction: {
                    circle: {
                      center: { latitude: query.center.lat, longitude: query.center.lng },
                      radius: query.radiusM,
                    },
                  },
                },
          ),
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
      const candidate = normalizePlace(
        value,
        category,
        fetchedAt,
        query.discovery ? types : undefined,
      );
      return candidate ? [candidate] : [];
    });
  }

  /** Short-lived image URL with no key in it. For this response only; never store it. */
  async photoUrl(name: string, options?: { signal?: AbortSignal }): Promise<string> {
    if (!/^places\/[^/]+\/photos\/[^/]+$/.test(name)) throw new Error('Invalid photo name');
    const uri = str(
      record(
        await this.request(
          `${name}/media?maxWidthPx=800&skipHttpRedirect=true`,
          null,
          { method: 'GET' },
          options?.signal,
        ),
      ).photoUri,
    );
    if (!uri?.startsWith('https://')) throw new Error('Invalid Google photo response');
    return uri;
  }

  /** One place, for when it has dropped out of the repeat search. Null if it has closed. */
  async pickPlace(placeId: string, category: Category): Promise<Candidate | null> {
    if (!placeId.trim() || placeId.length > 256) throw new Error('Invalid place ID');
    const place = normalizePlace(
      await this.request(`places/${encodeURIComponent(placeId)}`, PICK_FIELDS.join(','), {
        method: 'GET',
      }),
      category,
      this.now().toISOString(),
    );
    return place?.placeId === placeId ? place : null;
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
