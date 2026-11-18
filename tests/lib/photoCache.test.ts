import { api } from '@/lib/api';
import { clearPhotoCache, loadPhoto } from '@/lib/photoCache';

jest.mock('@/lib/api', () => ({ api: { discoverPhoto: jest.fn() } }));

beforeEach(() => {
  jest.resetAllMocks();
  clearPhotoCache();
  jest
    .mocked(api.discoverPhoto)
    .mockImplementation(async (name: string) => ({ photoUrl: `https://img/${name}` }));
});

test('concurrent and later requests for one photo share a single backend call', async () => {
  // e.g. Discover and the onboarding deck asking at once, then a remounted screen.
  const [a, b] = await Promise.all([
    loadPhoto('places/p/photos/1'),
    loadPhoto('places/p/photos/1'),
  ]);
  expect(await loadPhoto('places/p/photos/1')).toBe('https://img/places/p/photos/1');
  expect(a).toBe(b);
  expect(api.discoverPhoto).toHaveBeenCalledTimes(1);
});

test('keys by photo, so a place with a new photo loads that photo', async () => {
  await loadPhoto('places/p/photos/1');
  expect(await loadPhoto('places/p/photos/2')).toBe('https://img/places/p/photos/2');
  expect(api.discoverPhoto).toHaveBeenCalledTimes(2);
});

test('expired photos are fetched again; failures retry sooner', async () => {
  const start = Date.now();
  await loadPhoto('places/p/photos/1', start);
  await loadPhoto('places/p/photos/1', start + 49 * 60_000);
  expect(api.discoverPhoto).toHaveBeenCalledTimes(1);
  await loadPhoto('places/p/photos/1', start + 51 * 60_000);
  expect(api.discoverPhoto).toHaveBeenCalledTimes(2);

  jest.mocked(api.discoverPhoto).mockRejectedValueOnce(new Error('rate limited'));
  expect(await loadPhoto('places/p/photos/2')).toBeNull();
  expect(await loadPhoto('places/p/photos/2')).toBeNull();
  expect(api.discoverPhoto).toHaveBeenCalledTimes(3);
  expect(await loadPhoto('places/p/photos/2', Date.now() + 6 * 60_000)).toBe(
    'https://img/places/p/photos/2',
  );
});

test('holds at most 200 photos, dropping the least recently used', async () => {
  for (let i = 0; i < 200; i++) await loadPhoto(`places/p/photos/${i}`);
  await loadPhoto('places/p/photos/0'); // used again, so photo 1 is now the oldest
  await loadPhoto('places/p/photos/200');
  jest.mocked(api.discoverPhoto).mockClear();
  await loadPhoto('places/p/photos/0');
  expect(api.discoverPhoto).not.toHaveBeenCalled();
  await loadPhoto('places/p/photos/1');
  expect(api.discoverPhoto).toHaveBeenCalledTimes(1);
});
