import {
  ACTIVITY_TYPES,
  CUISINES,
  FOOD_TYPES,
  applyDiscoverFilters,
  discoverSearchTypes,
  matchesDiscovery,
  matchesPrice,
  narrowsSearch,
} from '@shared/domain/discoverFilters.ts';
import { boundingBox, distanceMeters } from '@shared/domain/geo.ts';
import { discover, parseDiscover } from '@shared/api/discover.ts';
import { createPoolBuilder } from '@shared/places/pool.ts';
import {
  GoogleProvider,
  DISCOVER_FIELD_MASK,
  PICK_SEARCH_MASK,
  textQuery,
  textSearchBody,
} from '@shared/places/GoogleProvider.ts';
import { MemoryPlaceCache, cacheKey, queryIdentity } from '@shared/places/cache.ts';
import { MockProvider } from '@shared/places/MockProvider.ts';
import { budgetedHttp } from '@shared/places/budget.ts';
import type { Candidate } from '@shared/places/types.ts';
import { CAMPUS } from '@/lib/places';
import {
  activeFilterCount,
  defaultDiscoverFilters,
  discoverFilterParams,
  emptyFilterMessage,
  milesToMeters,
  resetDiscoverFilters,
} from '@/lib/discoverFilters';
const place: Candidate = {
  ...CAMPUS,
  placeId: 'a',
  name: 'A',
  category: 'food',
  rating: 4,
  priceLevel: 2,
  types: ['restaurant', 'italian_restaurant', 'pizza_restaurant'],
};
const parse = (query = '') =>
  parseDiscover(new URLSearchParams(`lat=${CAMPUS.lat}&lng=${CAMPUS.lng}${query}`));
test.each([
  '&minRating=3',
  '&minRating=',
  '&minRating=NaN',
  '&sort=popular',
  '&cuisines=italian',
  '&category=food&cuisines=bogus',
  '&category=food&cuisines=italian,italian',
  '&category=activities&foodTypes=pizza',
  '&category=food&activityTypes=bowling',
  '&radiusM=50001',
  '&activityTypes=escape_rooms',
  '&prices=0',
  '&prices=5',
  '&prices=',
  '&prices=2,2',
  '&prices=1.5',
  '&prices=two',
  '&category=activities&prices=2',
  '&prices=2&priceMax=2',
  '&openNow=yes',
])('rejects invalid/irrelevant constraints %s', (query) => expect(() => parse(query)).toThrow());
test('category lists are canonical, and the shared parameters apply to both For You branches', () => {
  expect(parse('&category=food&cuisines=italian,american')[0]!.discovery?.cuisines).toEqual([
    'american',
    'italian',
  ]);
  expect(parse('&minRating=4&sort=nearest').map((r) => r.discovery)).toEqual([
    { minRating: 4, sort: 'nearest' },
    { minRating: 4, sort: 'nearest' },
  ]);
});
test('OR within sections and AND between cuisine/food type; Any does not exclude unrated/unknown types', () => {
  expect(
    matchesDiscovery(place, { cuisines: ['chinese', 'italian'], foodTypes: ['pizza', 'burgers'] }),
  ).toBe(true);
  expect(matchesDiscovery(place, { cuisines: ['italian'], foodTypes: ['burgers'] })).toBe(false);
  expect(matchesDiscovery({ ...place, rating: null, types: [] }, {})).toBe(true);
  for (const rating of [undefined, null, 3.9])
    expect(matchesDiscovery({ ...place, rating }, { minRating: 4 })).toBe(false);
  expect(matchesDiscovery(place, { minRating: 4 })).toBe(true);
  expect(matchesDiscovery(place, { minRating: 4.5 })).toBe(false);
});
test('catalog options each have a bounded provider mapping; unsupported classifications are absent', () => {
  for (const option of CUISINES)
    expect(discoverSearchTypes('food', { cuisines: [option.value] })).toEqual([...option.types]);
  for (const option of FOOD_TYPES)
    expect(discoverSearchTypes('food', { foodTypes: [option.value] })).toEqual([...option.types]);
  for (const option of ACTIVITY_TYPES)
    expect(discoverSearchTypes('activities', { activityTypes: [option.value] })).toEqual([
      ...option.types,
    ]);
  expect(discoverSearchTypes('food', { cuisines: ['italian'], foodTypes: ['pizza'] })).toEqual([
    'italian_restaurant',
  ]);
});
test('shared controls and independent categories survive tab changes and reset only the current tab', () => {
  const f = {
    ...defaultDiscoverFilters(),
    cuisines: ['italian'],
    activityTypes: ['bowling'],
    prices: [3, 1],
    minRating: 4,
    openNow: true,
  };
  expect(discoverFilterParams(f, 'food')).toMatchObject({
    cuisines: ['italian'],
    prices: [1, 3],
    minRating: 4,
    openNow: true,
  });
  expect(discoverFilterParams(f, 'activities')).not.toHaveProperty('cuisines');
  expect(discoverFilterParams(f, 'activities')).not.toHaveProperty('prices');
  expect(discoverFilterParams(f, 'all')).toMatchObject({ prices: [1, 3] });
  expect(activeFilterCount(f, 'activities')).toBe(3); // rating, open now, bowling
  expect(discoverFilterParams(f, 'all')).not.toHaveProperty('activityTypes');
  expect(resetDiscoverFilters(f, 'food')).toMatchObject({
    cuisines: [],
    activityTypes: ['bowling'],
    prices: [],
  });
  expect(activeFilterCount(f, 'food')).toBe(4);
});
test('miles conversion preserves the existing default and validates bounds', () => {
  expect(defaultDiscoverFilters().radiusM).toBe(5000);
  expect(milesToMeters(1)).toBe(1609);
  expect(milesToMeters(25)).toBe(40234);
  expect(parse('&radiusM=40234')[0]!.radiusM).toBe(40234);
  for (const v of [0, 25.1, NaN, Infinity]) expect(() => milesToMeters(v)).toThrow();
});
test('categories, thresholds and sort all participate in cache/request identity', () => {
  const base = parse('&category=food')[0]!;
  for (const discovery of [
    { cuisines: ['italian'] },
    { foodTypes: ['pizza'] },
    { minRating: 4 },
    { prices: [2] },
    { prices: [1, 2] },
    { openNow: true },
    { sort: 'nearest' as const },
  ]) {
    expect(cacheKey({ ...base, discovery })).not.toBe(cacheKey(base));
    expect(queryIdentity({ ...base, discovery })).not.toBe(queryIdentity(base));
  }
});
test('Google performs one OR search, uses the Discover mask, retains real review counts, and never exposes its key', async () => {
  const http = jest.fn(async () => ({
    ok: true,
    json: async () => ({
      places: [
        {
          id: 'g',
          displayName: { text: 'Google pizza' },
          location: { latitude: CAMPUS.lat, longitude: CAMPUS.lng },
          types: ['restaurant', 'italian_restaurant', 'pizza_restaurant'],
          rating: 4.5,
          userRatingCount: 123,
          priceLevel: 'PRICE_LEVEL_FREE',
        },
      ],
    }),
  }));
  const provider = new GoogleProvider('secret', http);
  const query = parse('&category=food&cuisines=italian,chinese&foodTypes=pizza&sort=nearest')[0]!;
  const result = await createPoolBuilder(provider, { provider: 'google' }).buildPool(query);
  expect(result[0]).toMatchObject({ rating: 4.5, userRatingCount: 123, priceLevel: 0 });
  expect(JSON.stringify(result)).not.toContain('secret');
  expect(http).toHaveBeenCalledTimes(1);
  const init = (http.mock.calls[0] as unknown as [string, RequestInit])[1];
  expect(JSON.parse(init.body as string)).toMatchObject({
    includedTypes: ['italian_restaurant', 'chinese_restaurant'],
    maxResultCount: 20,
    rankPreference: 'DISTANCE',
  });
  expect((init.headers as Record<string, string>)['X-Goog-FieldMask']).toBe(DISCOVER_FIELD_MASK);
  expect(PICK_SEARCH_MASK).not.toContain('userRatingCount');
});
test('each mapped activity is accepted by Google normalization instead of the legacy Pick-only mapping', async () => {
  for (const option of ACTIVITY_TYPES) {
    const provider = new GoogleProvider('key', async () => ({
      ok: true,
      json: async () => ({
        places: [
          {
            id: option.value,
            displayName: { text: option.label },
            location: { latitude: CAMPUS.lat, longitude: CAMPUS.lng },
            types: [option.types[0]],
          },
        ],
      }),
    }));
    expect(
      await provider.search(parse(`&category=activities&activityTypes=${option.value}`)[0]!),
    ).toHaveLength(1);
  }
});
test('legacy priceMax from older app builds keeps its maximum meaning, for food only', async () => {
  const provider = {
    search: async () => [
      { ...place, placeId: 'unknown', priceLevel: null },
      { ...place, placeId: 'paid', priceLevel: 2 },
      { ...place, placeId: 'free', priceLevel: 0 },
    ],
  };
  const pool = createPoolBuilder(provider, { cache: new MemoryPlaceCache() });
  expect(
    (await pool.buildPool({ ...parse('&category=food&priceMax=0')[0]!, poolSize: 1 })).map(
      (p) => p.placeId,
    ),
  ).toEqual(['free']);
  expect(parse('&priceMax=2').map((r) => r.priceMax)).toEqual([2, null]);
  expect(parse('&category=activities&priceMax=2')[0]!.priceMax).toBeNull();
});
test('price is exact and multi-select: $$ is only $$; $ and $$ are both; unknown never matches', () => {
  const at = (priceLevel: number | null) => ({ ...place, priceLevel });
  expect(matchesPrice(at(2), [2])).toBe(true);
  expect(matchesPrice(at(1), [2])).toBe(false);
  expect(matchesPrice(at(3), [2])).toBe(false);
  expect([1, 2, 3].map((p) => matchesPrice(at(p), [1, 2]))).toEqual([true, true, false]);
  expect(matchesPrice(at(null), [1, 2, 3, 4])).toBe(false);
  expect(matchesPrice(at(0), [1])).toBe(false);
  expect(matchesPrice(at(null), undefined)).toBe(true);
});
test('price never applies to activities, so an unpriced activity is not filtered out', () => {
  const activity: Candidate = { ...place, category: 'activities', priceLevel: null };
  expect(matchesPrice(activity, [2])).toBe(true);
  const result = applyDiscoverFilters(
    [activity, { ...place, placeId: 'cheap', priceLevel: 1 }],
    { prices: [2] },
    new Date(),
  );
  expect(result.places.map((p) => p.placeId)).toEqual(['a']);
  expect(result.emptyBecause).toEqual([]);
});
test('prices are canonical and only reach the food search, including For You', () => {
  expect(parse('&category=food&prices=3,1')[0]!.discovery?.prices).toEqual([1, 3]);
  const [food, activities] = parse('&prices=2&openNow=true');
  expect(food).toMatchObject({ category: 'food', discovery: { prices: [2], openNow: true } });
  expect(activities!.category).toBe('activities');
  expect(activities!.discovery).toEqual({ openNow: true });
  // The pool must not drop places without hours; discover() reports them instead.
  expect([food!.openNow, activities!.openNow]).toEqual([false, false]);
});
test('a filter that removes everything is named, and places without hours are reported, not hidden', () => {
  const now = new Date('2026-10-26T16:00:00Z');
  const always = { periods: [], alwaysOpen: true };
  const closed = { periods: [], closed: true };
  expect(applyDiscoverFilters([place], { prices: [4] }, now)).toMatchObject({
    places: [],
    emptyBecause: ['price'],
  });
  expect(
    applyDiscoverFilters(
      [{ ...place, openingHours: closed, timezone: 'America/New_York' }],
      { openNow: true },
      now,
    ),
  ).toMatchObject({ places: [], emptyBecause: ['openNow'] });
  const unknown = applyDiscoverFilters([{ ...place, openingHours: null }], { openNow: true }, now);
  expect(unknown).toMatchObject({ hoursUnknown: 1, hoursUnverified: true, emptyBecause: [] });
  expect(unknown.places).toHaveLength(1);
  const mixed = applyDiscoverFilters(
    [
      { ...place, placeId: 'open', openingHours: always, timezone: 'America/New_York' },
      { ...place, placeId: 'unknown', openingHours: null },
    ],
    { openNow: true },
    now,
  );
  expect(mixed.places.map((p) => p.placeId)).toEqual(['open']);
  expect(mixed).toMatchObject({ hoursUnknown: 1, hoursUnverified: false });
  expect(
    applyDiscoverFilters([], { prices: [2], minRating: 4, cuisines: ['thai'] }, now).emptyBecause,
  ).toEqual(['price', 'rating', 'type']);
});
test('the empty-state message names the filter in words', () => {
  const f = { ...defaultDiscoverFilters(), prices: [2, 3], minRating: 4 };
  expect(emptyFilterMessage(['price'], f, 'food')?.title).toBe('No $$ or $$$ places nearby.');
  expect(emptyFilterMessage(['price'], f, 'all')?.body).toContain('$$ or $$$ price (food)');
  expect(emptyFilterMessage(['price', 'rating'], f, 'food')?.body).toContain('rated 4.0+');
  expect(emptyFilterMessage(['openNow'], f, 'food')?.title).toBe(
    'Nothing nearby is open right now.',
  );
  expect(emptyFilterMessage([], f, 'food')).toBeNull();
});
test('Discover through the API: an activity-only price never empties Activities or For You', async () => {
  const pool = createPoolBuilder(new MockProvider());
  // Old behavior: any price filter hid every unpriced activity. Activities can't send price now,
  // and For You applies it to food only.
  const forYou = await discover(pool, parse('&prices=2&radiusM=40234'), {});
  expect(forYou.places.some((p) => p.category === 'activities')).toBe(true);
  expect(forYou.places.filter((p) => p.category === 'food').every((p) => p.priceLevel === 2)).toBe(
    true,
  );
  const open = await discover(pool, parse('&category=activities&openNow=true&radiusM=40234'), {});
  // Fixtures list no hours, so Open Now shows them and says so instead of returning nothing.
  expect(open.places.length).toBeGreaterThan(0);
  expect(open).toMatchObject({ hoursUnverified: true, emptyBecause: [] });
});
test.each([
  ['nearest', 'near'],
  ['rating', 'rated'],
  ['reviews', 'reviewed'],
])(
  '%s sorts the full bounded candidate set before the final 20, with deterministic ties',
  async (sort, first) => {
    const candidates = [
      ...Array.from({ length: 22 }, (_, i) => ({
        ...place,
        placeId: `z${i}`,
        lat: CAMPUS.lat + 0.01,
        rating: 3,
        userRatingCount: 2,
      })),
      { ...place, placeId: 'near', rating: 2, userRatingCount: 0 },
      { ...place, placeId: 'rated', lat: CAMPUS.lat + 0.02, rating: 5, userRatingCount: 3 },
      { ...place, placeId: 'reviewed', lat: CAMPUS.lat + 0.03, rating: null, userRatingCount: 100 },
    ];
    const feed = await discover(
      { buildPool: async () => candidates },
      parse(`&category=food&sort=${sort}`),
      {},
    );
    expect(feed.places).toHaveLength(20);
    expect(feed.places[0]!.placeId).toBe(first);
    const reversed = await discover(
      { buildPool: async () => [...candidates].reverse() },
      parse(`&category=food&sort=${sort}`),
      {},
    );
    expect(reversed.places.map((p) => p.placeId)).toEqual(feed.places.map((p) => p.placeId));
  },
);
test('mock fixtures match the same explicit type rules without fabricating ratings, prices or review counts', async () => {
  const pool = createPoolBuilder(new MockProvider());
  const selected = await pool.buildPool(parse('&category=food&cuisines=italian&radiusM=40234')[0]!);
  expect(selected.length).toBeGreaterThan(0);
  expect(selected.every((p) => p.types?.includes('italian_restaurant'))).toBe(true);
  expect(await pool.buildPool(parse('&category=food&minRating=4')[0]!)).toEqual([]);
});
test('multiple categories cannot bypass the shared paid-call budget, including fallback', async () => {
  let attempts = 0;
  const raw = jest.fn(async () => ({ ok: true, json: async () => ({ places: [] }) }));
  const provider = new GoogleProvider(
    'key',
    budgetedHttp(async () => ++attempts <= 1, raw),
  );
  const pool = createPoolBuilder(provider, { provider: 'google', fallback: new MockProvider() });
  const result = await discover(pool, parse('&category=food&cuisines=italian,chinese'), {});
  expect(attempts).toBe(1);
  expect(raw).toHaveBeenCalledTimes(1);
  expect(result.fallback).toBe(true);
});

test('location and radius changes are included in the request/cache identity', () => {
  const request = parse('&category=food')[0]!;
  const moved = { ...request, center: { ...request.center, lat: request.center.lat + 1 } };
  expect(queryIdentity(moved)).not.toBe(queryIdentity(request));
  expect(cacheKey(moved)).not.toBe(cacheKey(request));
  expect(queryIdentity({ ...request, radiusM: 10000 })).not.toBe(queryIdentity(request));
});

const googlePlace = (id: string, priceLevel = 'PRICE_LEVEL_MODERATE') => ({
  id,
  displayName: { text: id },
  location: { latitude: CAMPUS.lat, longitude: CAMPUS.lng },
  types: ['restaurant', 'italian_restaurant'],
  priceLevel,
  rating: 4.4,
});
test('narrowing filters use Text Search with exact priceLevels around the user; no filter keeps Nearby', async () => {
  const http = jest.fn(async (_url: string, _init: RequestInit) => ({
    ok: true,
    json: async () => ({ places: [googlePlace('new-italian')] }),
  }));
  const provider = new GoogleProvider('secret', http);
  const center = { lat: 40.9465, lng: -73.0693 };
  const request = (query: string) =>
    parseDiscover(new URLSearchParams(`lat=${center.lat}&lng=${center.lng}${query}`))[0]!;
  await provider.search(request('&category=food&cuisines=italian&prices=2,1&minRating=4'));
  const [url, init] = http.mock.calls[0]!;
  expect(url).toBe('https://places.googleapis.com/v1/places:searchText');
  const body = JSON.parse(init.body as string);
  expect(body).toMatchObject({
    textQuery: 'italian restaurant',
    includedType: 'italian_restaurant',
    strictTypeFiltering: true,
    priceLevels: ['PRICE_LEVEL_INEXPENSIVE', 'PRICE_LEVEL_MODERATE'],
    minRating: 4,
    pageSize: 20,
    rankPreference: 'RELEVANCE',
  });
  expect(body).not.toHaveProperty('maxResultCount');
  const { low, high } = body.locationRestriction.rectangle;
  expect(low.latitude).toBeLessThan(center.lat);
  expect(high.longitude).toBeGreaterThan(center.lng);
  expect((init.headers as Record<string, string>)['X-Goog-FieldMask']).toBe(DISCOVER_FIELD_MASK);

  http.mockClear();
  await provider.search(request('&category=food&cuisines=italian'));
  expect(http.mock.calls[0]![0]).toBe('https://places.googleapis.com/v1/places:searchNearby');
});
test('Text Search bodies: several types become one query, nearest passes through, open now stays local', () => {
  const center = { lat: 40.9, lng: -73.1 };
  const body = textSearchBody(
    {
      center,
      radiusM: 8000,
      category: 'food',
      discovery: { foodTypes: ['burgers', 'pizza'], openNow: true, sort: 'nearest' },
    },
    discoverSearchTypes('food', { foodTypes: ['burgers', 'pizza'] }),
  );
  expect(body).toMatchObject({ textQuery: 'pizza restaurant or hamburger restaurant' });
  expect(body).not.toHaveProperty('openNow');
  expect(body).toMatchObject({ rankPreference: 'DISTANCE' });
  expect(body).not.toHaveProperty('includedType');
  expect(body).not.toHaveProperty('priceLevels');
  expect(
    textSearchBody(
      { center, radiusM: 8000, category: 'activities', discovery: { minRating: 4, prices: [2] } },
      ['park'],
    ),
  ).not.toHaveProperty('priceLevels');
  expect(
    textSearchBody({ center, radiusM: 8000, category: 'food', discovery: {} }, []).textQuery,
  ).toBe('restaurants');
  expect(narrowsSearch({ cuisines: ['thai'] })).toBe(false);
  expect(narrowsSearch({ openNow: true })).toBe(false);
  expect(narrowsSearch({ prices: [1] })).toBe(true);
});
test('the Text Search rectangle contains the whole search circle', () => {
  const center = { lat: 40.9126, lng: -73.1234 };
  const { low, high } = boundingBox(center, 10000);
  for (const corner of [
    { lat: low.lat, lng: center.lng },
    { lat: high.lat, lng: center.lng },
    { lat: center.lat, lng: low.lng },
    { lat: center.lat, lng: high.lng },
  ])
    expect(distanceMeters(center, corner)).toBeGreaterThanOrEqual(9999);
});
test('Text Search counts against the shared daily cap, and results are new matches, not a trim', async () => {
  let reserved = 0;
  const raw = jest.fn(async () => ({
    ok: true,
    json: async () => ({ places: [googlePlace('only-moderate')] }),
  }));
  const provider = new GoogleProvider(
    'key',
    budgetedHttp(async () => ++reserved <= 1, raw),
  );
  const pool = createPoolBuilder(provider, { provider: 'google', fallback: new MockProvider() });
  const first = await discover(pool, parse('&category=food&prices=2'), {});
  expect(first.places.map((p) => p.placeId)).toEqual(['only-moderate']);
  expect(first.fallback).toBe(false);
  const capped = await discover(pool, parse('&category=food&prices=2'), {});
  expect(raw).toHaveBeenCalledTimes(1);
  expect(capped.fallback).toBe(true);
});

test('Text Search queries are generic per category, and Activities never get a food query', () => {
  const body = (query: string) => {
    const r = parse(query).find((x) => narrowsSearch(x.discovery))!;
    return textSearchBody(r as never, discoverSearchTypes(r.category, r.discovery!));
  };
  expect(body('&category=food&prices=2').textQuery).toBe('restaurants');
  expect(body('&prices=2').textQuery).toBe('restaurants');
  // For You + price: the activities search has no narrowing filter, so it stays on Nearby.
  expect(parse('&prices=2').map((r) => narrowsSearch(r.discovery))).toEqual([true, false]);
  expect(body('&category=activities&minRating=4').textQuery).toBe('things to do');
  expect(body('&category=activities&activityTypes=bowling&minRating=4')).toMatchObject({
    textQuery: 'bowling alley',
    includedType: 'bowling_alley',
  });
  expect(body('&category=activities&activityTypes=sports&minRating=4').textQuery).toBe(
    'sports complex or athletic field or stadium',
  );
  const food = /\b(restaurants?|food|cafes?|bakery|dining|eat)\b/i;
  for (const option of ACTIVITY_TYPES) {
    const q = textQuery('activities', { activityTypes: [option.value] }, [...option.types]);
    expect(q).not.toMatch(food);
  }
  expect(textQuery('activities', {}, [])).not.toMatch(food);
});

test('Open Now keeps Google places with unknown hours as the unverified fallback', async () => {
  const sent: Record<string, unknown>[] = [];
  const http = jest.fn(async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(init.body as string));
    return { ok: true, json: async () => ({ places: [googlePlace('no-hours')] }) };
  });
  const pool = createPoolBuilder(new GoogleProvider('key', http), { provider: 'google' });
  for (const query of ['&category=food&openNow=true', '&category=food&prices=2&openNow=true']) {
    sent.length = 0;
    const result = await discover(pool, parse(query), {});
    expect(sent.some((body) => 'openNow' in body)).toBe(false);
    expect(result.places.map((p) => p.placeId)).toEqual(['no-hours']);
    // Shown, but flagged unverified: never presented as confirmed open.
    expect(result.hoursUnverified).toBe(true);
  }
  // Open Now alone adds nothing Google can narrow, so it stays on Nearby Search.
  http.mockClear();
  await discover(pool, parse('&category=food&openNow=true'), {});
  expect(http.mock.calls[0]![0]).toBe('https://places.googleapis.com/v1/places:searchNearby');
});

test.each([
  ['', 'searchNearby'],
  ['&prices=2', 'searchText'],
])('Open Now uses current Google hours through %s (%s)', async (priceFilter, method) => {
  const now = new Date('2026-12-25T17:00:00Z');
  const withWeeklyHours = (id: string, start: number, end: number) => ({
    ...googlePlace(id),
    regularOpeningHours: {
      periods: [{ open: { day: 5, hour: start }, close: { day: 5, hour: end } }],
    },
    timeZone: { id: 'America/New_York' },
  });
  const holidayClosed = {
    ...withWeeklyHours('holiday-closed', 9, 17),
    currentOpeningHours: { openNow: false },
  };
  const holidayOpen = {
    ...withWeeklyHours('holiday-open', 14, 17),
    currentOpeningHours: { openNow: true },
  };
  const ordinary = {
    ...withWeeklyHours('ordinary', 9, 17),
    currentOpeningHours: { openNow: true },
  };
  const weeklyOnly = withWeeklyHours('weekly-only', 9, 17);
  const noHours = googlePlace('no-hours');
  const wrongPrice = { ...holidayOpen, ...googlePlace('wrong-price', 'PRICE_LEVEL_EXPENSIVE') };
  let places = [holidayClosed, holidayOpen, ordinary, weeklyOnly, noHours, wrongPrice];
  const http = jest.fn(async (_url: string, _init: RequestInit) => ({
    ok: true,
    json: async () => ({ places }),
  }));
  const pool = createPoolBuilder(new GoogleProvider('key', http), { provider: 'google' });
  const requests = parse(`&category=food&openNow=true${priceFilter}`);

  const result = await discover(pool, requests, {}, now);
  expect(result.places.map((p) => p.placeId).sort()).toEqual(
    priceFilter ? ['holiday-open', 'ordinary'] : ['holiday-open', 'ordinary', 'wrong-price'],
  );
  expect(result).toMatchObject({ hoursUnknown: 2, hoursUnverified: false });
  expect(http).toHaveBeenCalledTimes(1);
  const [url, init] = http.mock.calls[0]!;
  expect(url).toBe(`https://places.googleapis.com/v1/places:${method}`);
  expect((init.headers as Record<string, string>)['X-Goog-FieldMask']).toBe(
    `${DISCOVER_FIELD_MASK},places.currentOpeningHours.openNow`,
  );
  expect(JSON.parse(init.body as string)).not.toHaveProperty('openNow');

  places = [holidayClosed, weeklyOnly, noHours];
  const fallback = await discover(pool, requests, {}, now);
  expect(fallback.places.map((p) => p.placeId).sort()).toEqual(['no-hours', 'weekly-only']);
  expect(fallback).toMatchObject({ hoursUnknown: 2, hoursUnverified: true });
});
