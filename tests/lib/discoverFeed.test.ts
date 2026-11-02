import type { Candidate } from '@shared/places/types.ts';
import { discoverPlace, googleKind } from '@/lib/discoverFeed';
import { formatRating, CAMPUS } from '@/lib/places';

const google = (overrides: Partial<Candidate>): Candidate => ({
  placeId: 'g1',
  name: 'Place',
  category: 'food',
  lat: CAMPUS.lat,
  lng: CAMPUS.lng,
  provider: 'google',
  fetchedAt: '2026-11-02T00:00:00.000Z',
  retention: 'request',
  ...overrides,
});

test('the most specific Google type wins, whatever order Google sends', () => {
  expect(googleKind(['restaurant', 'food', 'vietnamese_restaurant'], 'food').kind).toBe(
    'Vietnamese',
  );
  expect(googleKind(['fast_food_restaurant', 'hamburger_restaurant'], 'food').kind).toBe('Burgers');
  expect(googleKind(['cafe', 'coffee_shop'], 'food').kind).toBe('Coffee');
  expect(googleKind(['park', 'hiking_area'], 'activities').kind).toBe('Hiking');
  expect(googleKind(['movie_theater', 'performing_arts_theater'], 'activities').kind).toBe(
    'Theater',
  );
  expect(googleKind(['museum', 'concert_hall'], 'activities').kind).toBe('Music venue');
  expect(googleKind(['performing_arts_theater'], 'activities')).toEqual({
    kind: 'Theater',
    emoji: '🎭',
  });
});

test('unlisted types get a generic label, and activities are never bowling by default', () => {
  expect(googleKind(['restaurant'], 'food')).toEqual({ kind: 'Food', emoji: '🍽️' });
  expect(googleKind(undefined, 'food').kind).toBe('Food');
  expect(googleKind(['tourist_attraction'], 'activities')).toEqual({
    kind: 'Activity',
    emoji: '📍',
  });
});

test('types of the other category are ignored', () => {
  expect(googleKind(['park'], 'food').kind).toBe('Food');
  expect(googleKind(['cafe'], 'activities').kind).toBe('Activity');
});

test('Google places carry their label, icon and rating into the feed', () => {
  const place = discoverPlace(google({ types: ['pizza_restaurant'], rating: 4.63 }), CAMPUS);
  expect(place).toMatchObject({ kind: 'Pizza', cuisine: 'Pizza', emoji: '🍕', rating: 4.63 });
});

test('ratings format to one decimal, and unrated places show none', () => {
  expect(formatRating(4.63)).toBe('★ 4.6');
  expect(formatRating(5)).toBe('★ 5.0');
  expect(formatRating(null)).toBeNull();
  expect(formatRating(0)).toBeNull();
});
