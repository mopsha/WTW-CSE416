import { discoverScore, rankDiscover } from '@shared/domain/discoverScore.ts';
import type { Candidate } from '@shared/places/types.ts';
const center = { lat: 40.9, lng: -73.1 };
const place: Candidate = {
  ...center,
  placeId: 'a',
  name: 'A',
  category: 'food',
  rating: 4,
  priceLevel: 1,
  types: ['cafe'],
};
test('caller preferences affect the individual score only', () => {
  expect(
    discoverScore(place, { categories: ['food'], types: ['cafe'], priceMax: 2 }, center),
  ).toBeGreaterThan(discoverScore(place, {}, center));
  expect(discoverScore(place, { categories: ['activities'] }, center)).toBe(
    discoverScore(place, {}, center),
  );
});
test('a well-rated place outranks a poorly rated one that only matches the survey', () => {
  const liked = { ...place, placeId: 'liked', rating: 2.5 };
  const better = { ...place, placeId: 'better', category: 'activities' as const, types: ['park'] };
  better.rating = 4.8;
  expect(
    rankDiscover(
      [liked, better],
      { categories: ['food'], types: ['cafe'], priceMax: 2 },
      center,
    )[0]!.placeId,
  ).toBe('better');
});
test('unrated places sort below rated ones', () => {
  const unrated = { ...place, placeId: 'unrated', rating: null };
  const rated = { ...place, placeId: 'rated', rating: 3.5 };
  expect(rankDiscover([unrated, rated], {}, center)[0]!.placeId).toBe('rated');
});
test('bounded, deduplicated, deterministic and does not mutate input', () => {
  const places = Array.from({ length: 25 }, (_, i) => ({
    ...place,
    placeId: String(i).padStart(2, '0'),
  })).reverse();
  const before = [...places];
  expect(rankDiscover([...places, place], {}, center)).toHaveLength(20);
  expect(rankDiscover(places, {}, center)[0]!.placeId).toBe('00');
  expect(places).toEqual(before);
});
