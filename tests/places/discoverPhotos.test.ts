import { withPhotos } from '@shared/api/discover.ts';
import { GoogleProvider } from '@shared/places/GoogleProvider.ts';
import type { Candidate } from '@shared/places/types.ts';

const google: Candidate = {
  placeId: 'g',
  name: 'G',
  category: 'food',
  lat: 40,
  lng: -73,
  provider: 'google',
  attributions: [{ provider: 'Existing' }],
  photos: [{ name: 'places/g/photos/1', authorAttributions: [{ displayName: 'Ana' }] }],
};

test('adds the first photo and its author credit', async () => {
  const resolve = jest.fn(async () => 'https://img.example/1');
  const [place] = await withPhotos([google], resolve);
  expect(resolve).toHaveBeenCalledTimes(1);
  expect(resolve).toHaveBeenCalledWith('places/g/photos/1');
  expect(place).toMatchObject({
    photoUrl: 'https://img.example/1',
    attributions: [{ provider: 'Existing' }, { provider: 'Ana' }],
  });
});

test('a failed photo keeps the place and non-Google places are skipped', async () => {
  const failed = await withPhotos([google], async () => {
    throw new Error('over cap');
  });
  expect(failed).toEqual([google]);
  const resolve = jest.fn(async () => 'https://img.example/1');
  const mock = { ...google, provider: 'mock' as const };
  const noPhoto = { ...google, photos: [] };
  expect(await withPhotos([mock, noPhoto], resolve)).toEqual([mock, noPhoto]);
  expect(resolve).not.toHaveBeenCalled();
});

test('photoUrl asks for the key-free URL and sends the key only as a header', async () => {
  const http = jest.fn(async (_url: string, _init: RequestInit) => ({
    ok: true,
    json: async () => ({ photoUri: 'https://img.example/1' }),
  }));
  const provider = new GoogleProvider('test-only', http);
  await expect(provider.photoUrl('places/g/photos/1')).resolves.toBe('https://img.example/1');
  const [url, init] = http.mock.calls[0]!;
  expect(url).toBe(
    'https://places.googleapis.com/v1/places/g/photos/1/media?maxWidthPx=800&skipHttpRedirect=true',
  );
  expect(url).not.toContain('test-only');
  expect(init.headers).toMatchObject({ 'X-Goog-Api-Key': 'test-only' });
  expect(init.headers).not.toHaveProperty('X-Goog-FieldMask');
});

test('photoUrl rejects bad names and responses', async () => {
  const http = jest.fn(async () => ({ ok: true, json: async () => ({ photoUri: 'http://x' }) }));
  const provider = new GoogleProvider('test-only', http);
  await expect(provider.photoUrl('../places:searchNearby')).rejects.toThrow('Invalid photo name');
  expect(http).not.toHaveBeenCalled();
  await expect(provider.photoUrl('places/g/photos/1')).rejects.toThrow('Invalid Google photo');
});
