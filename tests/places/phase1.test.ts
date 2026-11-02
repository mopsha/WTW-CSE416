import { matchesFilters } from '@shared/domain/placeFilters.ts';
import { createPoolBuilder, NoCandidatesError } from '@shared/places/pool.ts';
import { MemoryPlaceCache } from '@shared/places/cache.ts';
import { budgetedHttp, ProviderCapError } from '@shared/places/budget.ts';
import { discover, parseDiscover } from '@shared/api/discover.ts';
import { MockProvider } from '@shared/places/MockProvider.ts';
import type { Candidate } from '@shared/places/types.ts';
const center = { lat: 40.9126, lng: -73.1234 };
const place: Candidate = {
  ...center,
  placeId: 'a',
  name: 'A',
  category: 'food',
  priceLevel: 1,
  timezone: 'America/New_York',
  openingHours: {
    periods: [{ open: { day: 1, hour: 10, minute: 0 }, close: { day: 1, hour: 12, minute: 0 } }],
  },
};
const at = new Date('2026-10-26T15:00:00Z');
test('price and hours include boundaries and exclude unknowns and closing time', () => {
  expect(matchesFilters(place, { priceMax: 1, openNow: true }, at)).toBe(true);
  expect(matchesFilters(place, { priceMax: 0 }, at)).toBe(false);
  expect(matchesFilters({ ...place, priceLevel: null }, { priceMax: 4 }, at)).toBe(false);
  expect(matchesFilters({ ...place, openingHours: null }, { openNow: true }, at)).toBe(false);
  expect(matchesFilters(place, { openNow: true }, new Date('2026-10-26T16:00:00Z'))).toBe(false);
});
test('cache first, filters before truncation, radius always enforced, no filtered cache pollution', async () => {
  const search = jest.fn(async () => [
    { ...place, placeId: 'expensive', priceLevel: 4 },
    { ...place, placeId: 'outside', lat: 41 },
    place,
  ]);
  const pool = createPoolBuilder({ search }, { cache: new MemoryPlaceCache(), now: () => at });
  const request = {
    center,
    radiusM: 1000,
    category: 'food' as const,
    poolSize: 1,
    priceMax: 1,
    openNow: true,
  };
  expect((await pool.buildPool(request)).map((p) => p.placeId)).toEqual(['a']);
  expect(await pool.buildPool({ ...request, priceMax: 4, poolSize: 30 })).toHaveLength(2);
  expect(search).toHaveBeenCalledTimes(1);
});
test('cap reserves before network, counts failures and falls back without sending an extra call', async () => {
  let calls = 0;
  const http = jest.fn(async () => {
    throw new Error('provider down');
  });
  const bounded = budgetedHttp(async () => ++calls <= 1, http);
  await expect(bounded('https://example.test', {})).rejects.toThrow('provider down');
  await expect(bounded('https://example.test', {})).rejects.toBeInstanceOf(ProviderCapError);
  expect(http).toHaveBeenCalledTimes(1);
  const pool = createPoolBuilder(
    {
      search: async () => {
        await bounded('https://example.test', {});
        return [];
      },
    },
    { provider: 'google', fallback: { search: async () => [place] } },
  );
  const result = await discover(
    pool,
    [{ center, radiusM: 1000, category: 'food', poolSize: 20 }],
    {},
  );
  expect(result.fallback).toBe(true);
  expect(result.places[0]!.provider).toBe('mock');
  expect(http).toHaveBeenCalledTimes(1);
});
test('invalid query values fail before provider access; no pagination contract', () => {
  for (const suffix of [
    '&openNow=1',
    '&priceMax=5',
    '&priceMax=',
    '&radiusM=0',
    '&category=nope',
  ]) {
    expect(() => parseDiscover(new URLSearchParams('lat=40&lng=-73' + suffix))).toThrow();
  }
  expect(() => parseDiscover(new URLSearchParams('lat=&lng=-73'))).toThrow();
  expect(parseDiscover(new URLSearchParams('lat=40&lng=-73'))).toHaveLength(2);
});
test('activity provider fixtures are activities and Discover stays within 20', async () => {
  const provider = new MockProvider();
  const activities = await provider.search({ center, radiusM: 16000, category: 'activities' });
  expect(activities.length).toBeGreaterThan(5);
  expect(
    activities.every((p) => p.category === 'activities' && p.placeId.startsWith('sbu-act-')),
  ).toBe(true);
  const feed = await discover(
    createPoolBuilder(provider),
    parseDiscover(new URLSearchParams(`lat=${center.lat}&lng=${center.lng}&radiusM=16000`)),
    { categories: ['activities'] },
  );
  expect(feed.places).toHaveLength(20);
  expect(feed.places[0]!.category).toBe('activities');
});

test('empty fallback still reports fallback and a failed branch does not hide other results', async () => {
  const requests = parseDiscover(new URLSearchParams(`lat=${center.lat}&lng=${center.lng}`));
  const result = await discover(
    {
      buildPool: async (request) => {
        if (request.category === 'food') throw new NoCandidatesError(true);
        return [{ ...place, placeId: 'live', category: 'activities', provider: 'google' }];
      },
    },
    requests,
    {},
  );
  expect(result.places).toHaveLength(1);
  expect(result.fallback).toBe(true);
});

test('counter storage failure fails closed before paid HTTP', async () => {
  const http = jest.fn();
  const request = budgetedHttp(async () => {
    throw new Error('storage unavailable');
  }, http);
  await expect(request('https://example.test', {})).rejects.toThrow('storage unavailable');
  expect(http).not.toHaveBeenCalled();
});

test('an empty filtered fallback still reports fallback rather than a successful live feed', async () => {
  const pool = createPoolBuilder(
    {
      search: async () => {
        throw new ProviderCapError();
      },
    },
    {
      provider: 'google',
      fallback: { search: async () => [place] },
    },
  );
  const result = await discover(
    pool,
    [{ center, category: 'food', radiusM: 1000, poolSize: 20, priceMax: 0 }],
    {},
  );
  expect(result).toMatchObject({ fallback: true, places: [] });
});
