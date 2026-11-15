import {
  ACTIVITY_TYPES,
  CUISINES,
  FOOD_TYPES,
  discoverSearchTypes,
  matchesDiscovery,
} from '@shared/domain/discoverFilters.ts';
import { discover, parseDiscover } from '@shared/api/discover.ts';
import { createPoolBuilder } from '@shared/places/pool.ts';
import {
  GoogleProvider,
  DISCOVER_FIELD_MASK,
  PICK_SEARCH_MASK,
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
    priceMax: 0,
    minRating: 4,
    openNow: true,
  };
  expect(discoverFilterParams(f, 'food')).toMatchObject({
    cuisines: ['italian'],
    priceMax: 0,
    minRating: 4,
    openNow: true,
  });
  expect(discoverFilterParams(f, 'activities')).not.toHaveProperty('cuisines');
  expect(discoverFilterParams(f, 'all')).not.toHaveProperty('activityTypes');
  expect(resetDiscoverFilters(f, 'food')).toMatchObject({
    cuisines: [],
    activityTypes: ['bowling'],
    priceMax: -1,
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
test('strict price/rating filters run before limits, and unknown price never means Free', async () => {
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
