import { EMPTY_PREFERENCES } from '@shared/domain/preferences.ts';

import { buildTasteDeck, preferencesFromSwipes, TASTE_PER_CATEGORY } from '@/lib/tasteDeck';

const place = (id: string, ...types: string[]) => ({ id, types });

describe('buildTasteDeck', () => {
  it('uses one real place per type, then fills with type cards, alternating categories', () => {
    const deck = buildTasteDeck(
      [
        place('a', 'restaurant', 'sushi_restaurant', 'japanese_restaurant'),
        place('b', 'sushi_restaurant'), // a already took Sushi (its first own type) → skipped
        place('c', 'restaurant'), // no survey type → skipped
        place('d', 'pizza_restaurant'),
      ],
      [place('e', 'bowling_alley')],
    );
    expect(deck).toHaveLength(TASTE_PER_CATEGORY * 2);
    expect(deck.slice(0, 4).map((c) => [c.category, c.type, c.place?.id ?? null])).toEqual([
      ['food', 'sushi_restaurant', 'a'],
      ['activities', 'bowling_alley', 'e'],
      ['food', 'pizza_restaurant', 'd'],
      ['activities', 'movie_theater', null],
    ]);
    expect(new Set(deck.map((c) => c.type)).size).toBe(deck.length);
  });

  it('a place teaches its primary type, not the first one in the survey list', () => {
    // American comes before Pizza in the survey, but this place is mainly a pizza place.
    const [card] = buildTasteDeck([place('p', 'pizza_restaurant', 'american_restaurant')], []);
    expect(card!.type).toBe('pizza_restaurant');
  });

  it('works fully offline', () => {
    const deck = buildTasteDeck([], []);
    expect(deck).toHaveLength(TASTE_PER_CATEGORY * 2);
    expect(deck.every((c) => c.place === null)).toBe(true);
  });
});

describe('preferencesFromSwipes', () => {
  it('Yes likes the type and category, No skips it, Maybe changes nothing', () => {
    const result = preferencesFromSwipes(
      { ...EMPTY_PREFERENCES, dislikedTypes: ['sushi_restaurant'], priceMax: 2 },
      [
        { card: { type: 'sushi_restaurant', category: 'food' }, value: 2 },
        { card: { type: 'bowling_alley', category: 'activities' }, value: 0 },
        { card: { type: 'park', category: 'activities' }, value: 1 },
      ],
    );
    expect(result).toEqual({
      ...EMPTY_PREFERENCES,
      priceMax: 2,
      categories: ['food'],
      types: ['sushi_restaurant'],
      dislikedTypes: ['bowling_alley'],
    });
  });
});

describe('candidate taste type from a Pick snapshot', () => {
  // Imported here to keep this file about taste; the mapper lives with the other place helpers.
  const { candidateFromApi } = jest.requireActual<typeof import('@/lib/places')>('@/lib/places');
  it('keeps the survey type for the "Matches your taste" badge', () => {
    expect(
      candidateFromApi({
        placeId: 'g1',
        provider: 'google',
        name: null,
        lat: 0,
        lng: 0,
        tasteType: 'sushi_restaurant',
      }).tasteType,
    ).toBe('sushi_restaurant');
    expect(candidateFromApi({ placeId: 'g2', name: 'x', tasteType: 7 })).not.toHaveProperty(
      'tasteType',
    );
  });
});
