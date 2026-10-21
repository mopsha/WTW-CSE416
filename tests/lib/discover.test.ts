import { DISCOVER_PLACES, filterDiscover, milesBetween, milesLabel } from '@/lib/discover';
import { CAMPUS } from '@/lib/places';

test('one fixed list of 30-40 real places, the same for everyone', () => {
  expect(DISCOVER_PLACES.length).toBeGreaterThanOrEqual(30);
  expect(DISCOVER_PLACES.length).toBeLessThanOrEqual(40);
  expect(DISCOVER_PLACES.filter((p) => p.category === 'food')).toHaveLength(20);
  expect(DISCOVER_PLACES.filter((p) => p.category === 'activities').length).toBeGreaterThan(10);
});

test('every place is complete and near Stony Brook', () => {
  const ids = new Set<string>();
  for (const p of DISCOVER_PLACES) {
    expect(ids.has(p.placeId)).toBe(false);
    ids.add(p.placeId);
    expect(p.name.trim()).not.toBe('');
    expect(p.name).not.toMatch(/placeholder/i);
    expect(p.kind.trim()).not.toBe('');
    expect(p.address?.trim()).toBeTruthy();
    expect(p.emoji).toBeTruthy();
    // Within ~10 miles of the SBU Academic Mall.
    expect(milesBetween(CAMPUS, p)).toBeLessThan(10);
    if (p.priceLevel !== null) expect([1, 2, 3, 4]).toContain(p.priceLevel);
  }
});

test('nearest first', () => {
  const miles = DISCOVER_PLACES.map((p) => p.miles);
  expect(miles).toEqual([...miles].sort((a, b) => a - b));
});

test('filter by category and search name, kind or address', () => {
  expect(
    filterDiscover(DISCOVER_PLACES, { category: 'food' }).every((p) => p.category === 'food'),
  ).toBe(true);
  expect(
    filterDiscover(DISCOVER_PLACES, { category: 'activities' }).every(
      (p) => p.category === 'activities',
    ),
  ).toBe(true);
  expect(filterDiscover(DISCOVER_PLACES, { query: 'beach' }).map((p) => p.name)).toEqual(
    expect.arrayContaining(['West Meadow Beach', 'Sunken Meadow State Park']),
  );
  expect(filterDiscover(DISCOVER_PLACES, { query: '  PORT jefferson ' }).length).toBeGreaterThan(3);
  expect(filterDiscover(DISCOVER_PLACES, { category: 'food', query: 'beach' })).toEqual([]);
  expect(filterDiscover(DISCOVER_PLACES, { query: 'zzzz' })).toEqual([]);
  // Filtering keeps nearest-first order.
  const food = filterDiscover(DISCOVER_PLACES, { category: 'food' }).map((p) => p.miles);
  expect(food).toEqual([...food].sort((a, b) => a - b));
});

test('miles label', () => {
  expect(milesLabel(0.2)).toBe('on campus');
  expect(milesLabel(3.456)).toBe('3.5 mi');
});
