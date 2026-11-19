import * as Location from 'expo-location';

import { placeLabel, searchLocations } from '@/lib/locationSearch';

jest.mock('@/lib/config', () => ({ USE_MOCK: false }));
jest.mock('expo-location', () => ({
  geocodeAsync: jest.fn(),
  reverseGeocodeAsync: jest.fn(),
  PermissionStatus: { GRANTED: 'granted' },
}));

const hit = (latitude: number, longitude: number) => ({ latitude, longitude }) as never;

test('names each geocoder hit instead of echoing the query with coordinates', async () => {
  jest.mocked(Location.geocodeAsync).mockResolvedValue([hit(39.8, -89.6), hit(42.1, -72.6)]);
  jest
    .mocked(Location.reverseGeocodeAsync)
    .mockResolvedValueOnce([
      { city: 'Springfield', region: 'Illinois', country: 'United States' },
    ] as never)
    .mockResolvedValueOnce([
      { city: 'Springfield', region: 'Massachusetts', country: 'United States' },
    ] as never);
  const results = await searchLocations('Spr');
  expect(results.map((r) => [r.label, r.detail])).toEqual([
    ['Springfield', 'Illinois, United States'],
    ['Springfield', 'Massachusetts, United States'],
  ]);
  expect(results[0]!.center).toEqual({ lat: 39.8, lng: -89.6 });
});

test('drops hits at the same spot, keeps different places with the same name', async () => {
  jest
    .mocked(Location.geocodeAsync)
    .mockResolvedValue([hit(1, 1), hit(1.0001, 1.0001), hit(1.2, 1.2), hit(5, 5)]);
  const boston = [{ city: 'Boston', region: 'Massachusetts', country: 'United States' }] as never;
  jest
    .mocked(Location.reverseGeocodeAsync)
    .mockResolvedValueOnce(boston)
    .mockResolvedValueOnce(boston)
    .mockRejectedValueOnce(new Error('offline'));
  const results = await searchLocations('Boston');
  expect(results.map((r) => [r.label, r.detail])).toEqual([
    ['Boston', 'Massachusetts, United States'],
    ['Boston', 'Massachusetts, United States'],
    ['Boston', 'Nearby area'],
  ]);
});

test('shows hits before their names arrive, and stops naming a stale search', async () => {
  jest.mocked(Location.geocodeAsync).mockResolvedValue([hit(10, 10), hit(20, 20)]);
  jest.mocked(Location.reverseGeocodeAsync).mockClear();
  let lookedUp!: () => void;
  jest.mocked(Location.reverseGeocodeAsync).mockReturnValueOnce(
    new Promise((resolve) => {
      lookedUp = () => resolve([{ city: 'Albany', region: 'New York' }] as never);
    }),
  );
  let current = true;
  const onUpdate = jest.fn();
  const first = await searchLocations('Alb', { onUpdate, isCurrent: () => current });
  expect(first.map((r) => r.detail)).toEqual(['Finding the area…', 'Finding the area…']);
  current = false;
  lookedUp();
  await new Promise((r) => setTimeout(r, 0));
  expect(onUpdate).not.toHaveBeenCalled();
  expect(Location.reverseGeocodeAsync).toHaveBeenCalledTimes(1);
});

test('labels the part the user typed: a street or neighborhood, not just the city', () => {
  expect(
    placeLabel(
      { name: '1 Main St', district: 'Back Bay', city: 'Boston', region: 'Massachusetts' },
      'back bay',
    ),
  ).toEqual({ label: 'Back Bay', detail: 'Boston, Massachusetts' });
  expect(
    placeLabel({ name: '12 Main St', city: 'Boston', region: 'Massachusetts' }, '12 main st'),
  ).toEqual({ label: '12 Main St', detail: 'Boston, Massachusetts' });
});

test('placeLabel never repeats the name in the detail', () => {
  expect(
    placeLabel({ city: 'New York', region: 'New York', country: 'United States' }, 'ny'),
  ).toEqual({
    label: 'New York',
    detail: 'United States',
  });
});
