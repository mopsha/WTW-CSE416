import {
  ACTIVITY_TYPE_OPTIONS,
  DISTANCE_OPTIONS,
  EMPTY_PREFERENCES,
  FOOD_TYPE_OPTIONS,
  readPreferences,
  validatePreferences,
} from '@shared/domain/preferences.ts';

describe('validatePreferences', () => {
  test('accepts a full answer and drops duplicates', () => {
    expect(
      validatePreferences({
        categories: ['food', 'activities', 'food'],
        types: ['pizza_restaurant', 'bowling_alley'],
        dislikedTypes: ['seafood_restaurant'],
        priceMax: 2,
        maxDistanceM: DISTANCE_OPTIONS[1]!.value,
      }),
    ).toEqual({
      preferences: {
        categories: ['food', 'activities'],
        types: ['pizza_restaurant', 'bowling_alley'],
        dislikedTypes: ['seafood_restaurant'],
        priceMax: 2,
        maxDistanceM: DISTANCE_OPTIONS[1]!.value,
      },
    });
  });

  test('an empty answer (the Skip button) is valid', () => {
    expect(validatePreferences({})).toEqual({ preferences: EMPTY_PREFERENCES });
  });

  test.each([
    ['not an object', []],
    ['unknown category', { categories: ['nightlife'] }],
    ['unknown type', { types: ['casino'] }],
    ['activity as a disliked cuisine', { dislikedTypes: ['zoo'] }],
    ['liked and skipped', { types: ['cafe'], dislikedTypes: ['cafe'] }],
    ['budget 0', { priceMax: 0 }],
    ['budget 5', { priceMax: 5 }],
    ['fractional budget', { priceMax: 1.5 }],
    ['distance not offered', { maxDistanceM: 1234 }],
    ['too many types', { types: Array(100).fill('cafe') }],
  ])('rejects %s', (_label, value) => {
    expect(validatePreferences(value)).toHaveProperty('error');
  });

  test('option values are unique, so a chip maps to exactly one stored type', () => {
    const values = [...FOOD_TYPE_OPTIONS, ...ACTIVITY_TYPE_OPTIONS].map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe('readPreferences', () => {
  test('keeps valid stored keys and treats bad or missing ones as unset', () => {
    expect(
      readPreferences({ types: ['cafe'], priceMax: 9, categories: 'food', extra: true }),
    ).toEqual({ ...EMPTY_PREFERENCES, types: ['cafe'] });
  });

  test.each([null, undefined, [], 'x'])('reads %p as no answers', (stored) => {
    expect(readPreferences(stored)).toEqual(EMPTY_PREFERENCES);
  });
});
