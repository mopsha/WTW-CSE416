import { MockProvider } from '@shared/places/MockProvider.ts';
import places from '../../supabase/seed/places.json';

const provider = new MockProvider();
const center = { lat: 40.9126, lng: -73.1234 };
test('loads bundled places', async () => {
  expect(await provider.search({ center, radiusM: 10000 })).toEqual(places);
});
test('combines radius and category filters', async () => {
  expect(
    (await provider.search({ center, radiusM: 1000, category: 'food' })).map((p) => p.placeId),
  ).toEqual(['placeholder-cafe']);
  expect(
    (await provider.search({ center, radiusM: 1000, category: 'activities' })).map(
      (p) => p.placeId,
    ),
  ).toEqual(['placeholder-park']);
});
test('includes exact radius boundary and allows empty results', async () => {
  expect(await provider.search({ center, radiusM: 0 })).toHaveLength(1);
  expect(await provider.search({ center: { lat: 0, lng: 0 }, radiusM: 100 })).toEqual([]);
});
test('results do not mutate fixture data', async () => {
  const result = await provider.search({ center, radiusM: 1000 });
  result[0]!.name = 'changed';
  expect((await provider.search({ center, radiusM: 1000 }))[0]!.name).not.toBe('changed');
});
test.each([-1, NaN, Infinity])('rejects invalid radius %s', async (radiusM) => {
  await expect(provider.search({ center, radiusM })).rejects.toThrow(RangeError);
});
test('rejects invalid coordinates', async () => {
  await expect(provider.search({ center: { lat: 91, lng: 0 }, radiusM: 1 })).rejects.toThrow(
    RangeError,
  );
});
