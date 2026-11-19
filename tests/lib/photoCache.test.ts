import { api } from '@/lib/api';
import {
  clearPhotoCache,
  loadPhoto,
  photoSource,
  photoState,
  releasePhotos,
  setPhotoSession,
  PHOTO_TTL_MS,
  FAILURE_TTL_MS,
} from '@/lib/photoCache';

jest.mock('@/lib/api', () => ({ api: { discoverPhoto: jest.fn() } }));
beforeEach(() => {
  jest.useFakeTimers();
  jest.resetAllMocks();
  setPhotoSession('A');
  jest
    .mocked(api.discoverPhoto)
    .mockImplementation(async (name) => ({ photoUrl: `https://img/${name}` }));
});
afterEach(() => {
  clearPhotoCache();
  jest.useRealTimers();
});
const source = (name = 'places/p/photos/1') => photoSource(name, 'A');

test('simultaneous consumers share a live resolution; consumed names are not cached across remounts', async () => {
  let finish!: (value: { photoUrl: string }) => void;
  jest.mocked(api.discoverPhoto).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const a = source(),
    b = source();
  const first = loadPhoto(a),
    second = loadPhoto(b);
  expect(api.discoverPhoto).toHaveBeenCalledTimes(1);
  finish({ photoUrl: 'https://img/1' });
  expect(await first).toBe('https://img/1');
  expect(await second).toBe('https://img/1');
  await loadPhoto(a);
  expect(api.discoverPhoto).toHaveBeenCalledTimes(1);
  releasePhotos([a, b]);
  await loadPhoto(source());
  expect(api.discoverPhoto).toHaveBeenCalledTimes(2);
});

test('A to B to A and logout invalidate old promises, even for the same photo', async () => {
  let finish!: (value: { photoUrl: string }) => void;
  jest.mocked(api.discoverPhoto).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const a = source();
  const old = loadPhoto(a);
  setPhotoSession('B');
  const b = photoSource('places/p/photos/1', 'B');
  await loadPhoto(b);
  expect(api.discoverPhoto).toHaveBeenLastCalledWith('places/p/photos/1', 'B');
  finish({ photoUrl: 'https://img/old-A' });
  expect(await old).toBeNull();
  expect(photoState(a).expired).toBe(true);
  expect(photoState(b).url).not.toBe('https://img/old-A');
  setPhotoSession(null);
  expect(photoState(b).expired).toBe(true);
  setPhotoSession('A');
  await loadPhoto(source());
  expect(api.discoverPhoto).toHaveBeenCalledTimes(3);
});

test('success and failure deadlines erase URLs and require fresh response metadata, never replaying the name', async () => {
  const a = source();
  await loadPhoto(a);
  jest.advanceTimersByTime(PHOTO_TTL_MS);
  expect(photoState(a).expired).toBe(true);
  expect(await loadPhoto(a)).toBeNull();
  expect(api.discoverPhoto).toHaveBeenCalledTimes(1);
  jest.mocked(api.discoverPhoto).mockRejectedValueOnce(new Error('offline'));
  const b = source('places/p/photos/2');
  await loadPhoto(b);
  expect(photoState(b).url).toBeNull();
  jest.advanceTimersByTime(FAILURE_TTL_MS);
  expect(photoState(b).expired).toBe(true);
  await loadPhoto(b);
  expect(api.discoverPhoto).toHaveBeenCalledTimes(2);
});

test('late old completions cannot overwrite a fresh photo identity or revive released state', async () => {
  let finish!: (value: { photoUrl: string }) => void;
  jest.mocked(api.discoverPhoto).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const a = source();
  const old = loadPhoto(a);
  releasePhotos([a]);
  const b = source('places/p/photos/2');
  await loadPhoto(b);
  finish({ photoUrl: 'https://img/old' });
  expect(await old).toBeNull();
  expect(photoState(b).url).toBe('https://img/places/p/photos/2');
});

test('bounds active entries to 200 and evicts the least recently used', async () => {
  const sources = Array.from({ length: 200 }, (_, i) => source(`places/p/photos/${i}`));
  await loadPhoto(sources[0]!);
  source('places/p/photos/200');
  expect(photoState(sources[0]!).expired).toBe(false);
  expect(photoState(sources[1]!).expired).toBe(true);
});

test('simultaneous failures deduplicate and an expired pending operation cannot revive an entry', async () => {
  let fail!: (reason: Error) => void;
  jest.mocked(api.discoverPhoto).mockReturnValueOnce(
    new Promise((_, reject) => {
      fail = reject;
    }),
  );
  const a = source(),
    b = source();
  const pa = loadPhoto(a),
    pb = loadPhoto(b);
  fail(new Error('quota'));
  expect(await pa).toBeNull();
  expect(await pb).toBeNull();
  expect(api.discoverPhoto).toHaveBeenCalledTimes(1);
  let finish!: (value: { photoUrl: string }) => void;
  jest.mocked(api.discoverPhoto).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const c = source('places/p/photos/3');
  const pc = loadPhoto(c);
  jest.advanceTimersByTime(PHOTO_TTL_MS);
  finish({ photoUrl: 'https://img/expired' });
  expect(await pc).toBeNull();
  expect(photoState(c).url).toBeUndefined();
});

test('hung resolutions time out and cannot retain a name or later revive their old result', async () => {
  let finish!: (value: { photoUrl: string }) => void;
  jest.mocked(api.discoverPhoto).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const a = source();
  const old = loadPhoto(a);
  jest.advanceTimersByTime(15_000);
  expect(await old).toBeNull();
  const fresh = source();
  await loadPhoto(fresh);
  expect(api.discoverPhoto).toHaveBeenCalledTimes(2);
  finish({ photoUrl: 'https://img/late' });
  await Promise.resolve();
  expect(photoState(a).url).toBeNull();
  expect(photoState(fresh).url).not.toBe('https://img/late');
});
