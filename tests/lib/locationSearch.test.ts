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

test('drops duplicate places and falls back to the query when naming fails', async () => {
  jest.mocked(Location.geocodeAsync).mockResolvedValue([hit(1, 1), hit(1.001, 1.001), hit(5, 5)]);
  const same = [{ city: 'Boston', region: 'Massachusetts', country: 'United States' }] as never;
  jest
    .mocked(Location.reverseGeocodeAsync)
    .mockResolvedValueOnce(same)
    .mockResolvedValueOnce(same)
    .mockRejectedValueOnce(new Error('offline'));
  const results = await searchLocations('Boston');
  expect(results.map((r) => [r.label, r.detail])).toEqual([
    ['Boston', 'Massachusetts, United States'],
    ['Boston', 'Nearby area'],
  ]);
});

test('placeLabel never repeats the name in the detail', () => {
  expect(
    placeLabel({ city: 'New York', region: 'New York', country: 'United States' }, 'ny'),
  ).toEqual({
    label: 'New York',
    detail: 'United States',
  });
});
