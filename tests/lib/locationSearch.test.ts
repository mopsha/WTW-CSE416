import * as Location from 'expo-location';

import { chosenLabel, describePlace, searchLocations } from '@/lib/locationSearch';

jest.mock('@/lib/config', () => ({ USE_MOCK: false }));
jest.mock('expo-location', () => ({
  geocodeAsync: jest.fn(),
  reverseGeocodeAsync: jest.fn(),
  PermissionStatus: { GRANTED: 'granted' },
}));

// Each test uses its own coordinates: answers are remembered across searches.
const hit = (latitude: number, longitude: number) => ({ latitude, longitude }) as never;
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => jest.mocked(Location.reverseGeocodeAsync).mockReset());

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
  expect(results.map((r) => [r.label, r.detail, chosenLabel(r)])).toEqual([
    ['Springfield', 'Illinois, United States', 'Springfield, Illinois'],
    ['Springfield', 'Massachusetts, United States', 'Springfield, Massachusetts'],
  ]);
  expect(results[0]!.center).toEqual({ lat: 39.8, lng: -89.6 });
});

test('drops hits at the same spot and tells same-named places apart', async () => {
  jest
    .mocked(Location.geocodeAsync)
    .mockResolvedValue([hit(1, 1), hit(1.0001, 1.0001), hit(1.2, 1.2), hit(5, 5)]);
  const boston = (district: string) =>
    [{ district, city: 'Boston', region: 'Massachusetts', country: 'United States' }] as never;
  jest
    .mocked(Location.reverseGeocodeAsync)
    .mockResolvedValueOnce(boston('Back Bay'))
    .mockResolvedValueOnce(boston('Dorchester'))
    .mockRejectedValueOnce(new Error('offline'));
  const results = await searchLocations('Boston');
  expect(results.map((r) => [r.label, r.detail])).toEqual([
    ['Boston', 'Back Bay · Massachusetts, United States'],
    ['Boston', 'Dorchester · Massachusetts, United States'],
    ['Boston', '5.00000, 5.00000 · Nearby area'],
  ]);
});

test('shows hits before their names arrive, then once named', async () => {
  jest.mocked(Location.geocodeAsync).mockResolvedValue([hit(10, 10)]);
  jest
    .mocked(Location.reverseGeocodeAsync)
    .mockResolvedValue([{ city: 'Albany', region: 'New York' }] as never);
  const onUpdate = jest.fn();
  const first = await searchLocations('Alb', { onUpdate });
  expect(first.map((r) => r.detail)).toEqual(['10.00000, 10.00000 · Finding the area…']);
  expect(chosenLabel(first[0]!)).toBe('10.00000, 10.00000');
  await settle();
  expect(onUpdate).toHaveBeenLastCalledWith([expect.objectContaining({ label: 'Albany' })]);
});

test('a remembered name is never replaced by "Finding the area…"', async () => {
  jest.mocked(Location.geocodeAsync).mockResolvedValue([hit(11, 11)]);
  jest
    .mocked(Location.reverseGeocodeAsync)
    .mockResolvedValue([{ city: 'Troy', region: 'New York' }] as never);
  await searchLocations('Troy');
  const onUpdate = jest.fn();
  await searchLocations('Troy', { onUpdate });
  await settle();
  expect(onUpdate.mock.calls.at(-1)![0][0]).toMatchObject({ label: 'Troy', detail: 'New York' });
  expect(Location.reverseGeocodeAsync).toHaveBeenCalledTimes(1);
});

test('searches share one lookup at a time, and stale searches start none', async () => {
  let answer!: () => void;
  jest.mocked(Location.reverseGeocodeAsync).mockImplementation(
    () =>
      new Promise((resolve) => {
        answer = () => resolve([{ city: 'Utica', region: 'New York' }] as never);
      }),
  );
  let latest = 0;
  for (let i = 0; i < 6; i++) {
    jest.mocked(Location.geocodeAsync).mockResolvedValueOnce([hit(20 + i, 20), hit(30 + i, 30)]);
    const id = ++latest;
    await searchLocations(`Utica ${i}`, { onUpdate: jest.fn(), isCurrent: () => id === latest });
  }
  await settle();
  // Only the first search's first lookup started; the stale ones gave up their turns.
  expect(Location.reverseGeocodeAsync).toHaveBeenCalledTimes(1);
  answer();
  await settle();
  // The newest search goes next, one hit at a time.
  expect(Location.reverseGeocodeAsync).toHaveBeenCalledTimes(2);
  expect(Location.reverseGeocodeAsync).toHaveBeenLastCalledWith({ latitude: 25, longitude: 20 });
  answer();
  await settle();
  answer();
  await settle();
});

test('labels the part the user typed, and keeps the city and region once chosen', () => {
  expect(
    describePlace(
      { name: '1 Main St', district: 'Back Bay', city: 'Boston', region: 'Massachusetts' },
      'back bay',
    ),
  ).toMatchObject({
    label: 'Back Bay',
    detail: 'Boston, Massachusetts',
    chosen: 'Back Bay, Boston, Massachusetts',
  });
  expect(
    describePlace({ name: '12 Main St', city: 'Boston', region: 'Massachusetts' }, '12 main st'),
  ).toMatchObject({ label: '12 Main St', chosen: '12 Main St, Boston, Massachusetts' });
  expect(
    describePlace(
      { city: 'Boston', subregion: 'Suffolk County', region: 'Massachusetts' },
      'Suffolk',
    ),
  ).toMatchObject({ chosen: 'Suffolk County, Boston, Massachusetts' });
  expect(
    describePlace({ city: 'New York', region: 'New York', country: 'United States' }, 'ny'),
  ).toMatchObject({ label: 'New York', detail: 'United States', chosen: 'New York' });
});

test('identical address metadata falls back to distinct coordinates without merging the hits', async () => {
  jest
    .mocked(Location.geocodeAsync)
    .mockResolvedValue([hit(40, 40), hit(40.00001, 40), hit(40.003, 40)]);
  jest
    .mocked(Location.reverseGeocodeAsync)
    .mockResolvedValue([{ city: 'Springfield', region: 'Illinois', postalCode: '12345' }] as never);
  const results = await searchLocations('Springfield');
  expect(results.map((item) => item.detail)).toEqual([
    '40.00000, 40.00000 · Illinois',
    '40.00300, 40.00000 · Illinois',
  ]);
  expect(results.map(chosenLabel)).toEqual([
    'Springfield, Illinois · 40.00000, 40.00000',
    'Springfield, Illinois · 40.00300, 40.00000',
  ]);
});

test('a hung obsolete call times out the queue without releasing its native slot', async () => {
  jest.useFakeTimers();
  let finish!: (results: Location.LocationGeocodedAddress[]) => void;
  try {
    jest.mocked(Location.reverseGeocodeAsync).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    let active = true;
    const obsoleteUpdate = jest.fn();
    const currentUpdate = jest.fn();
    jest.mocked(Location.geocodeAsync).mockResolvedValueOnce([hit(50, 50), hit(51, 50)]);
    await searchLocations('Old query', { isCurrent: () => active, onUpdate: obsoleteUpdate });
    active = false;
    jest.mocked(Location.geocodeAsync).mockResolvedValueOnce([hit(52, 50)]);
    await searchLocations('New query', { onUpdate: currentUpdate });
    await jest.advanceTimersByTimeAsync(2500);
    expect(Location.reverseGeocodeAsync).toHaveBeenCalledTimes(1);
    expect(obsoleteUpdate).toHaveBeenCalledTimes(1);
    expect(currentUpdate.mock.lastCall?.[0][0]).toMatchObject({
      detail: '52.00000, 50.00000 · Nearby area',
      chosen: '52.00000, 50.00000',
    });
    finish([{ city: 'Obsolete place' }] as never);
    await jest.advanceTimersByTimeAsync(0);
    expect(obsoleteUpdate).toHaveBeenCalledTimes(1);
    expect(currentUpdate).toHaveBeenCalledTimes(2);

    jest.mocked(Location.geocodeAsync).mockResolvedValueOnce([hit(52, 50)]);
    jest
      .mocked(Location.reverseGeocodeAsync)
      .mockResolvedValueOnce([{ city: 'New city' }] as never);
    expect((await searchLocations('New query')).map(chosenLabel)).toEqual(['New city']);
    expect(Location.reverseGeocodeAsync).toHaveBeenCalledTimes(2);
  } finally {
    jest.useRealTimers();
  }
});
