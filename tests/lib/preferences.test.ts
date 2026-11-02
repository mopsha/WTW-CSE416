import { DISTANCE_OPTIONS, EMPTY_PREFERENCES } from '@shared/domain/preferences.ts';

import { preferencesSummary } from '@/lib/preferences';

test('an empty survey reads "Not set yet"', () => {
  expect(preferencesSummary(EMPTY_PREFERENCES)).toBe('Not set yet');
});

test('summarizes every answered question in one line', () => {
  expect(
    preferencesSummary({
      categories: ['food'],
      types: ['cafe', 'pizza_restaurant', 'zoo'],
      dislikedTypes: ['sushi_restaurant'],
      priceMax: 2,
      maxDistanceM: DISTANCE_OPTIONS[2]!.value,
    }),
  ).toBe('Food · 3 favorites · up to $$ · within 5 mi');
});

test('both categories and a single favorite', () => {
  expect(
    preferencesSummary({
      ...EMPTY_PREFERENCES,
      categories: ['activities', 'food'],
      types: ['zoo'],
    }),
  ).toBe('Food and activities · 1 favorite');
});
