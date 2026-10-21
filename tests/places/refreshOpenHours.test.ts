import {
  createHoursRefresher,
  enrichResults,
  HOURS_TTL_MS,
  type HoursCache,
  type HoursRecord,
} from '@shared/places/refreshOpenHours.ts';
const now = () => new Date('2026-10-19T14:00:00Z');
const entry = (placeId: string, extra: Partial<HoursRecord> = {}): HoursRecord => ({
  placeId,
  provider: 'mock',
  fetchedAt: now().toISOString(),
  timezone: 'America/New_York',
  openingHours: {
    periods: [{ open: { day: 1, hour: 9, minute: 0 }, close: { day: 1, hour: 17, minute: 0 } }],
  },
  ...extra,
});
const cache = (entries: HoursRecord[]): HoursCache => ({
  get: jest.fn(async (id) => entries.find((e) => e.placeId === id) ?? null),
  set: jest.fn(async () => {}),
});
test('fresh entries avoid requests; exact seven-day boundary refreshes; IDs deduplicated', async () => {
  const store = cache([
    entry('fresh', { fetchedAt: new Date(now().getTime() - HOURS_TTL_MS + 1).toISOString() }),
    entry('stale', { fetchedAt: new Date(now().getTime() - HOURS_TTL_MS).toISOString() }),
  ]);
  const fetchHours = jest.fn(async (id: string) => entry(id));
  const result = await createHoursRefresher({
    provider: { fetchHours },
    cache: store,
    mode: 'mock',
    now,
  })(['fresh', 'stale', 'stale', 'missing']);
  expect(fetchHours.mock.calls).toEqual([
    ['stale', expect.anything()],
    ['missing', expect.anything()],
  ]);
  expect(result.map((h) => h.status)).toEqual(['fresh', 'refreshed', 'refreshed']);
  expect(result[0]).toMatchObject({ openNow: true, closesAt: '2026-10-19T21:00:00.000Z' });
});
test('partial failure preserves old cache but never asserts stale hours as current', async () => {
  const old = entry('bad', { fetchedAt: '2020-01-01T00:00:00Z' });
  const store = cache([old]);
  const result = await createHoursRefresher({
    cache: store,
    mode: 'mock',
    now,
    provider: {
      fetchHours: async (id) => {
        if (id === 'bad') throw Error('private');
        return entry(id);
      },
    },
  })(['bad', 'good']);
  expect(result[0]).toMatchObject({ status: 'unavailable', openNow: null, closesAt: null });
  expect(result[1]!.status).toBe('refreshed');
  expect(store.set).toHaveBeenCalledTimes(1);
  expect(old.fetchedAt).toBe('2020-01-01T00:00:00Z');
});
test('Google hours are never read/written to durable cache; fresh current observation wins', async () => {
  const store = cache([entry('g', { provider: 'google' })]);
  const fetchHours = jest.fn(async (id: string) =>
    entry(id, { provider: 'google', currentOpenNow: false }),
  );
  const refresh = createHoursRefresher({
    mode: 'google',
    provider: { fetchHours },
    cache: store,
    now,
  });
  expect((await refresh(['g']))[0]).toMatchObject({ openNow: false, closesAt: null });
  await refresh(['g']);
  expect(fetchHours).toHaveBeenCalledTimes(2);
  expect(store.get).not.toHaveBeenCalled();
  expect(store.set).not.toHaveBeenCalled();
});
test('bad ID/provenance/timestamp responses cannot overwrite cache', async () => {
  const store = cache([]);
  const refresh = createHoursRefresher({
    mode: 'mock',
    cache: store,
    now,
    provider: { fetchHours: async (id) => entry('wrong', { provider: 'google' }) },
  });
  expect((await refresh(['a']))[0]!.status).toBe('unavailable');
  expect(store.set).not.toHaveBeenCalled();
});
test('unknown hours stay null; enrichment preserves ranks and inputs', async () => {
  const result = await createHoursRefresher({
    mode: 'mock',
    now,
    provider: { fetchHours: async (id) => entry(id, { openingHours: null }) },
  })(['a']);
  const rows = Object.freeze([Object.freeze({ placeId: 'a', rank: 1 })]);
  expect(enrichResults(rows, result)).toEqual([
    { placeId: 'a', rank: 1, openNow: null, closesAt: null },
  ]);
  expect(rows[0]).toEqual({ placeId: 'a', rank: 1 });
});

test('known closed business stays closed without a timezone', async () => {
  const result = await createHoursRefresher({
    mode: 'google',
    now,
    provider: {
      fetchHours: async (id) =>
        entry(id, {
          provider: 'google',
          timezone: undefined,
          openingHours: { periods: [], closed: true },
          currentOpenNow: true,
        }),
    },
  })(['closed']);
  expect(result[0]).toMatchObject({ openNow: false, closesAt: null });
});
test('hours timeout aborts work and proceeds to other IDs', async () => {
  jest.useFakeTimers();
  try {
    let signal: AbortSignal | undefined;
    const refresh = createHoursRefresher({
      mode: 'mock',
      now,
      provider: {
        fetchHours: async (id, options) => {
          if (id === 'slow') {
            signal = options?.signal;
            return new Promise(() => {});
          }
          return entry(id);
        },
      },
    });
    const result = refresh(['slow', 'good']);
    await jest.advanceTimersByTimeAsync(3000);
    expect((await result).map((r) => r.status)).toEqual(['unavailable', 'refreshed']);
    expect(signal?.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});
