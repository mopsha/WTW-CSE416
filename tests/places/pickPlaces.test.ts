import { createPickPlaces, MAX_PLACE_LOOKUPS } from '@shared/places/pickPlaces.ts';
import { GoogleProvider, PICK_SEARCH_MASK, pickSearchMask } from '@shared/places/GoogleProvider.ts';
import { createConfiguredPoolBuilder } from '@shared/places/config.ts';
import type { Candidate } from '@shared/places/types.ts';

const center = { lat: 40.9, lng: -73.1 };
const stored = (placeId: string, category = 'food') => ({
  placeId,
  snapshot: { placeId, name: null, category, lat: 40.9, lng: -73.1, provider: 'google' },
});
const live = (placeId: string, extra: Partial<Candidate> = {}): Candidate => ({
  placeId,
  name: `Name ${placeId}`,
  category: 'food',
  lat: 40.91,
  lng: -73.11,
  address: '1 Main St',
  provider: 'google',
  retention: 'request',
  photos: [
    {
      name: `places/${placeId}/photos/1`,
      authorAttributions: [{ displayName: 'Ana', uri: 'https://a.example' }],
    },
  ],
  ...extra,
});
function source(found: Candidate[] = []) {
  return {
    search: jest.fn(async () => found),
    details: jest.fn(async (id: string) => live(id)),
    photo: jest.fn(async () => 'https://photo.example/1'),
  };
}
type Shown = {
  name: string | null;
  photoUrl?: string | null;
  attributions?: { provider: string }[];
};

test('one search fills every place, with no per-place lookups or photos', async () => {
  const s = source([live('a'), live('b')]);
  const shown = (await createPickPlaces(s)({
    center,
    radiusM: 1000,
    candidates: [stored('a'), stored('b')],
    photoIds: new Set(),
  })) as Shown[];
  expect(shown.map((p) => p.name)).toEqual(['Name a', 'Name b']);
  expect(s.search).toHaveBeenCalledTimes(1);
  expect(s.details).not.toHaveBeenCalled();
  expect(s.photo).not.toHaveBeenCalled();
});

test('a mixed Pick searches each category once', async () => {
  const s = source([live('a')]);
  await createPickPlaces(s)({
    center,
    radiusM: 1000,
    candidates: [stored('a'), stored('b', 'activities'), stored('c', 'activities')],
    photoIds: new Set(),
  });
  expect(s.search).toHaveBeenCalledTimes(2);
});

test('only requested places get a photo and its required credit', async () => {
  const s = source([live('a'), live('b')]);
  const shown = (await createPickPlaces(s)({
    center,
    radiusM: 1000,
    candidates: [stored('a'), stored('b')],
    photoIds: new Set(['a']),
  })) as Shown[];
  expect(s.photo).toHaveBeenCalledTimes(1);
  expect(shown[0]).toMatchObject({
    photoUrl: 'https://photo.example/1',
    attributions: [{ provider: 'Ana', providerUri: 'https://a.example' }],
  });
  expect(shown[1]!.photoUrl).toBeNull();
});

test('places missing from the search are looked up, up to the limit', async () => {
  const s = source([]);
  const ids = Array.from({ length: MAX_PLACE_LOOKUPS + 2 }, (_, i) => `p${i}`);
  const shown = (await createPickPlaces(s)({
    center,
    radiusM: 1000,
    candidates: ids.map((id) => stored(id)),
    photoIds: new Set(),
  })) as Shown[];
  expect(s.details).toHaveBeenCalledTimes(MAX_PLACE_LOOKUPS);
  expect(shown.at(-1)!.name).toBeNull();
});

test('provider failures leave places unnamed and never fail the Pick', async () => {
  const s = source();
  s.search.mockRejectedValue(new Error('over cap'));
  s.details.mockRejectedValue(new Error('over cap'));
  const shown = (await createPickPlaces(s)({
    center,
    radiusM: 1000,
    candidates: [stored('a')],
    photoIds: new Set(['a']),
  })) as Shown[];
  expect(shown[0]!.name).toBeNull();
});

test('other providers are returned as stored, without calling Google', async () => {
  const s = source();
  const custom = { placeId: 'custom:1', snapshot: { name: 'Mine', provider: 'custom' } };
  const shown = await createPickPlaces(s)({
    center,
    radiusM: 1000,
    candidates: [custom],
    photoIds: new Set(),
  });
  expect(shown).toEqual([custom.snapshot]);
  expect(s.search).not.toHaveBeenCalled();
});

test('the Pick search mask leaves out fields billed at a higher tier', async () => {
  for (const field of ['rating', 'priceLevel', 'regularOpeningHours', 'timeZone'])
    expect(PICK_SEARCH_MASK).not.toContain(field);
  const http = jest.fn(async () => ({ ok: true, json: async () => ({ places: [] }) }));
  await new GoogleProvider('key', http).search(
    { center, radiusM: 1000, category: 'food' },
    { mask: PICK_SEARCH_MASK },
  );
  const init = (http.mock.calls as unknown as [string, RequestInit][])[0]![1];
  expect((init.headers as Record<string, string>)['X-Goog-FieldMask']).toBe(PICK_SEARCH_MASK);
});

test('creating a Pick only pays for higher-tier fields when its filters need them', async () => {
  expect(pickSearchMask({ openNow: false, priceMax: null })).toBe(PICK_SEARCH_MASK);
  expect(pickSearchMask({})).toBe(PICK_SEARCH_MASK);
  expect(pickSearchMask({ openNow: true })).toBeUndefined();
  expect(pickSearchMask({ priceMax: 2 })).toBeUndefined();
  expect(pickSearchMask({ priceMax: 0 })).toBeUndefined();

  const http = jest.fn(async () => ({ ok: true, json: async () => ({ places: [] }) }));
  const pool = createConfiguredPoolBuilder(
    (name) => ({ PLACES_PROVIDER: 'google', GOOGLE_PLACES_API_KEY: 'key' })[name],
    { http, searchMask: pickSearchMask },
  );
  const base = { center, radiusM: 1000, category: 'food' as const, poolSize: 5 };
  const masks = () =>
    (http.mock.calls as unknown as [string, RequestInit][]).map(
      ([, init]) => (init.headers as Record<string, string>)['X-Goog-FieldMask'],
    );
  await pool.buildPool({ ...base, openNow: false }).catch(() => {});
  expect(masks()).toEqual([PICK_SEARCH_MASK]);
  await pool.buildPool({ ...base, openNow: true }).catch(() => {});
  expect(masks()[1]).toContain('regularOpeningHours');
});
