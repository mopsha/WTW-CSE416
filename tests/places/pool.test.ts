import { createPoolBuilder, candidateSnapshot } from '@shared/places/pool.ts';
import {
  MemoryPlaceCache,
  cacheEntry,
  cacheKey,
  isFresh,
  SEARCH_TTL_MS,
} from '@shared/places/cache.ts';
import type { Candidate } from '@shared/places/types.ts';
import { createConfiguredPoolBuilder, providerMode } from '@shared/places/config.ts';
import { withTimeout } from '@shared/places/timeout.ts';
const center = { lat: 40.9126, lng: -73.1234 };
const request = { center, radiusM: 1000, category: 'food' as const, poolSize: 3 };
const candidate = (placeId: string, extra: Partial<Candidate> = {}): Candidate => ({
  placeId,
  name: placeId,
  category: 'food',
  ...center,
  ...extra,
});
const clock = () => new Date('2026-10-19T14:00:00Z');

test('radius/category, dedupe, distance/rating/ID sort, cap; input and output isolation', async () => {
  const source = [
    candidate('far', { lat: 0 }),
    candidate('wrong', { category: 'activities' }),
    candidate('b', { rating: 4 }),
    candidate('a', { rating: 4 }),
    candidate('a', { rating: 3 }),
    candidate('c', { rating: 5 }),
    candidate('near', { lat: center.lat + 0.001 }),
  ];
  const provider = { search: async () => source };
  const pool = createPoolBuilder(provider, { now: clock });
  const result = await pool.buildPool(request);
  expect(result.map((p) => p.placeId)).toEqual(['c', 'a', 'b']);
  result[0]!.name = 'modified';
  expect(source[5]!.name).toBe('c');
  expect(
    (await createPoolBuilder({ search: async () => [...source].reverse() }).buildPool(request)).map(
      (p) => p.placeId,
    ),
  ).toEqual(['c', 'a', 'b']);
  expect((await pool.buildPool({ ...request, radiusM: 0 })).map((p) => p.placeId)).toEqual([
    'c',
    'a',
    'b',
  ]);
});
test('exception fallback sanitizes logs and labels mock provenance', async () => {
  const log = jest.fn();
  const pool = createPoolBuilder(
    {
      search: async () => {
        throw new Error('key-and-body');
      },
    },
    {
      provider: 'google',
      fallback: {
        search: async () => [candidate('a'), candidate('a'), candidate('far', { lat: 0 })],
      },
      log,
    },
  );
  expect(await pool.buildPool(request)).toEqual([
    expect.objectContaining({ placeId: 'a', provider: 'mock', retention: 'persistable' }),
  ]);
  expect(log).toHaveBeenCalledWith('provider_failed');
  expect(JSON.stringify(log.mock.calls)).not.toContain('key-and-body');
});
test('three-second timeout aborts primary, then fallback; all timers cleaned', async () => {
  jest.useFakeTimers();
  try {
    let signal: AbortSignal | undefined;
    const fallback = { search: jest.fn(async () => [candidate('mock')]) };
    const pool = createPoolBuilder(
      {
        search: async (_q, options) => {
          signal = options?.signal;
          return new Promise<Candidate[]>(() => {});
        },
      },
      { provider: 'google', fallback },
    );
    const pending = pool.buildPool(request);
    await jest.advanceTimersByTimeAsync(2999);
    expect(fallback.search).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect((await pending)[0]!.provider).toBe('mock');
    expect(signal?.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});
test('timeout cleans timers after success and parent abort stops work', async () => {
  jest.useFakeTimers();
  try {
    expect(await withTimeout(async () => 42)).toBe(42);
    expect(jest.getTimerCount()).toBe(0);
    const parent = new AbortController();
    parent.abort();
    const work = jest.fn(async () => 42);
    await expect(withTimeout(work, 3000, parent.signal)).rejects.toThrow('aborted');
    expect(work).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});
test('empty/unusable primary falls back; both unusable produces meaningful error', async () => {
  const empty = { search: async () => [candidate('outside', { lat: 0 })] };
  await expect(
    createPoolBuilder(empty, { fallback: empty }).buildPool(request),
  ).rejects.toMatchObject({ code: 'NO_USABLE_CANDIDATES' });
  await expect(
    createPoolBuilder(empty, {
      fallback: {
        search: async () => {
          throw Error('private');
        },
      },
    }).buildPool(request),
  ).rejects.toThrow('No usable nearby places');
  await expect(
    createPoolBuilder(empty, { fallback: { search: async () => [candidate('yes')] } }).buildPool(
      request,
    ),
  ).resolves.toHaveLength(1);
});
test('invalid input does not call providers', async () => {
  const search = jest.fn();
  await expect(
    createPoolBuilder({ search }).buildPool({ ...request, poolSize: 0 }),
  ).rejects.toThrow(RangeError);
  await expect(
    createPoolBuilder({ search }).buildPool({ ...request, radiusM: NaN }),
  ).rejects.toThrow(RangeError);
  expect(search).not.toHaveBeenCalled();
});
test('cache key rounds center and buckets radius, but includes category', () => {
  expect(cacheKey(request)).toBe(
    cacheKey({ ...request, center: { ...center, lat: center.lat + 0.00001 }, radiusM: 999 }),
  );
  expect(cacheKey(request)).not.toBe(cacheKey({ ...request, category: 'activities' }));
  expect(cacheKey(request)).not.toBe(cacheKey({ ...request, radiusM: 1001 }));
});
test('TTL expires exactly at boundary and rejects future/invalid timestamps', () => {
  expect(
    isFresh(new Date(clock().getTime() - SEARCH_TTL_MS + 1).toISOString(), clock(), SEARCH_TTL_MS),
  ).toBe(true);
  expect(
    isFresh(new Date(clock().getTime() - SEARCH_TTL_MS).toISOString(), clock(), SEARCH_TTL_MS),
  ).toBe(false);
  expect(isFresh('invalid', clock(), SEARCH_TTL_MS)).toBe(false);
  expect(isFresh(new Date(clock().getTime() + 1).toISOString(), clock(), SEARCH_TTL_MS)).toBe(
    false,
  );
});
test('mock cache avoids requests, keeps complete pool, guards bucket collisions, expires', async () => {
  let ms = clock().getTime();
  const search = jest.fn(async () => [candidate('a'), candidate('b')]);
  const pool = createPoolBuilder(
    { search },
    { cache: new MemoryPlaceCache(), now: () => new Date(ms) },
  );
  const first = await pool.buildPool({ ...request, poolSize: 1 });
  first[0]!.name = 'changed';
  expect(await pool.buildPool(request)).toHaveLength(2);
  expect(search).toHaveBeenCalledTimes(1);
  ms += SEARCH_TTL_MS;
  await pool.buildPool(request);
  expect(search).toHaveBeenCalledTimes(2);
  await pool.buildPool({ ...request, radiusM: 999 });
  expect(search).toHaveBeenCalledTimes(3);
});
test('Google durable cache allowlists IDs only; requests still fetch current content', async () => {
  const cache = new MemoryPlaceCache();
  const set = jest.spyOn(cache, 'set');
  const search = jest.fn(async () => [
    candidate('a', { provider: 'google', address: 'restricted', photos: [] }),
  ]);
  const pool = createPoolBuilder({ search }, { provider: 'google', cache, now: clock });
  await pool.buildPool(request);
  await pool.buildPool(request);
  expect(search).toHaveBeenCalledTimes(2);
  expect(set.mock.calls[0]![0]).toEqual(
    expect.objectContaining({ provider: 'google', placeIds: ['a'] }),
  );
  expect(JSON.stringify(set.mock.calls)).not.toContain('restricted');
  const entry = cacheEntry('k', 'q', [candidate('a')], 'google', clock().toISOString());
  const runtimeEntry = { ...entry, name: 'restricted' };
  await cache.set(runtimeEntry);
  expect(await cache.get('k')).not.toHaveProperty('name');
});
test('fallback never poisons Google cache; telemetry/cache failures cannot prevent results', async () => {
  const set = jest.fn();
  const primary = {
    search: async () => {
      throw Error();
    },
  };
  const pool = createPoolBuilder(primary, {
    provider: 'google',
    fallback: { search: async () => [candidate('a')] },
    cache: {
      get: async () => {
        throw Error();
      },
      set,
    },
    log: () => {
      throw Error();
    },
  });
  expect(await pool.buildPool(request)).toHaveLength(1);
  expect(set).not.toHaveBeenCalled();
});
test('snapshot guard rejects Google; owned candidates copied deeply', () => {
  expect(() => candidateSnapshot(candidate('a', { provider: 'google' }))).toThrow(
    'cannot be persisted',
  );
  expect(() =>
    cacheEntry('k', 'q', [candidate('a', { retention: 'request' })], 'mock', clock().toISOString()),
  ).toThrow('Restricted');
  const original = candidate('m', { types: ['cafe'] });
  const copy = candidateSnapshot(original);
  copy.types!.push('changed');
  expect(original.types).toEqual(['cafe']);
});
test('configuration defaults mock, rejects invalid/missing key, reads mode on every build', async () => {
  expect(providerMode(undefined)).toBe('mock');
  expect(providerMode('google')).toBe('google');
  expect(() => providerMode('GOOGLE')).toThrow('PLACES_PROVIDER');
  expect(() => providerMode('')).toThrow('PLACES_PROVIDER');
  let mode: string | undefined;
  const read = jest.fn((name: string) => (name === 'PLACES_PROVIDER' ? mode : undefined));
  const pool = createConfiguredPoolBuilder(read);
  expect((await pool.buildPool(request))[0]!.provider).toBe('mock');
  mode = 'google';
  await expect(pool.buildPool(request)).rejects.toThrow('not configured');
  mode = 'invalid';
  await expect(pool.buildPool(request)).rejects.toThrow('PLACES_PROVIDER');
  mode = 'mock';
  expect((await pool.buildPool(request))[0]!.provider).toBe('mock');
});
