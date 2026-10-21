import {
  GoogleProvider,
  NEARBY_FIELD_MASK,
  normalizeHours,
  normalizePlace,
} from '@shared/places/GoogleProvider.ts';
import { categoryMap } from '@shared/places/categoryMap.ts';
import fixture from './fixtures/google-nearby.json';
const now = () => new Date('2026-10-19T14:00:00Z');
const query = { center: { lat: 40.9126, lng: -73.1234 }, radiusM: 1000, category: 'food' as const };
const http = (data: unknown = fixture) =>
  jest.fn(async () => ({ ok: true, json: async () => data }));

test('Nearby Search uses bounded category request, explicit mask and header-only key', async () => {
  const fetch = http();
  const results = await new GoogleProvider('test-only', fetch, now).search(query);
  expect(fetch.mock.calls[0]).toEqual([
    'https://places.googleapis.com/v1/places:searchNearby',
    expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'X-Goog-FieldMask': NEARBY_FIELD_MASK }),
    }),
  ]);
  const init = (fetch.mock.calls as unknown as [string, RequestInit][])[0]![1];
  expect(JSON.parse(init.body as string)).toMatchObject({
    includedTypes: categoryMap.food,
    maxResultCount: 20,
    rankPreference: 'DISTANCE',
  });
  expect(JSON.stringify(results)).not.toContain('test-only');
  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({
    placeId: 'synthetic-cafe',
    name: 'Synthetic Cafe',
    address: '1 Fictional Street',
    priceLevel: 2,
    rating: 4.5,
    provider: 'google',
    retention: 'request',
    timezone: 'America/New_York',
    fetchedAt: now().toISOString(),
    photos: [{ authorAttributions: [{ displayName: 'Fixture Author' }] }],
    openingHours: { periods: [{ open: { day: 1, hour: 9, minute: 0 } }] },
  });
});
test('Activities mapping filters food and preserves missing optional fields as unknown', async () => {
  const result = await new GoogleProvider('test', http(), now).search({
    ...query,
    category: 'activities',
  });
  expect(categoryMap.activities).toContain('park');
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({
    placeId: 'synthetic-park',
    openingHours: null,
    rating: null,
    priceLevel: null,
  });
});
test.each([
  null,
  {},
  { id: 'x' },
  { ...fixture.places[0], location: { latitude: 91, longitude: 0 } },
  { ...fixture.places[0], businessStatus: 'CLOSED_PERMANENTLY' },
  { ...fixture.places[0], businessStatus: 'CLOSED_TEMPORARILY' },
])('invalid/closed candidate is excluded', (value) => {
  expect(normalizePlace(value, 'food', now().toISOString())).toBeNull();
});
test('optional malformed fields cannot fabricate rating, price or hours', () => {
  expect(
    normalizePlace(
      {
        ...fixture.places[0],
        rating: 'five',
        priceLevel: 'OTHER',
        regularOpeningHours: { periods: [{}] },
        photos: [null],
      },
      'food',
      now().toISOString(),
    ),
  ).toMatchObject({ rating: null, priceLevel: null, openingHours: null, photos: [] });
});
test('hours distinguish absent, empty, closed, 24/7 and malformed', () => {
  expect(normalizeHours({})).toBeNull();
  expect(normalizeHours({ periods: [] })).toEqual({ periods: [] });
  expect(normalizeHours(null, 'CLOSED_TEMPORARILY')).toEqual({ periods: [], closed: true });
  expect(normalizeHours({ periods: [{ open: { day: 0, hour: 0 } }] })).toEqual({
    periods: [],
    alwaysOpen: true,
  });
  expect(normalizeHours({ periods: [{ open: { day: 1, hour: 9 } }] })).toBeNull();
});
test('request and JSON failures are sanitized', async () => {
  const provider = new GoogleProvider('test', async () => {
    throw new Error('secret response body');
  });
  await expect(provider.search(query)).rejects.toThrow('Google Places request failed');
  await expect(
    new GoogleProvider('test', http({ places: 'invalid' })).search(query),
  ).rejects.toThrow('Invalid Google Places response');
  await expect(new GoogleProvider('test', http({})).search(query)).resolves.toEqual([]);
});
test('details uses encoded ID and minimal hours mask, preserving special-day observation', async () => {
  const fetch = http({
    id: 'a/b',
    regularOpeningHours: fixture.places[0]!.regularOpeningHours,
    timeZone: { id: 'America/New_York' },
    currentOpeningHours: { openNow: false },
  });
  const result = await new GoogleProvider('test', fetch, now).fetchHours('a/b');
  expect(fetch.mock.calls[0]).toEqual([
    'https://places.googleapis.com/v1/places/a%2Fb',
    expect.objectContaining({ method: 'GET' }),
  ]);
  expect(result).toMatchObject({ placeId: 'a/b', provider: 'google', currentOpenNow: false });
});
test('bad configuration and search input fail before HTTP', async () => {
  expect(() => new GoogleProvider('')).toThrow('not configured');
  const fetch = http();
  await expect(new GoogleProvider('test', fetch).search({ ...query, radiusM: -1 })).rejects.toThrow(
    RangeError,
  );
  expect(fetch).not.toHaveBeenCalled();
});

test('malformed, dated or truncated hours cannot become a weekly schedule', () => {
  for (const open of [
    'bad',
    [],
    { day: 1, hour: 9, truncated: true },
    { day: 1, hour: 9, date: { year: 2026 } },
  ]) {
    expect(normalizeHours({ periods: [{ open, close: { day: 1, hour: 17 } }] })).toBeNull();
  }
});
test('HTTP rejection and JSON parsing failures do not expose response content', async () => {
  await expect(
    new GoogleProvider('test', async () => ({
      ok: false,
      json: async () => ({ secret: 'body' }),
    })).search(query),
  ).rejects.toThrow('Google Places request failed');
  await expect(
    new GoogleProvider('test', async () => ({
      ok: true,
      json: async () => {
        throw Error('private body');
      },
    })).search(query),
  ).rejects.toThrow('Google Places request failed');
});
test('Google transport aborts at three seconds even without a pool wrapper', async () => {
  jest.useFakeTimers();
  try {
    let signal: AbortSignal | null | undefined;
    const provider = new GoogleProvider('test', async (_url, init) => {
      signal = init.signal;
      return new Promise(() => {});
    });
    const result = expect(provider.search(query)).rejects.toThrow('timed out');
    await jest.advanceTimersByTimeAsync(3000);
    await result;
    expect(signal?.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});
