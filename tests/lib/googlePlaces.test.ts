import type { Candidate } from '@/lib/types';

test('release mode disables direct Google lookups even with a public key present', async () => {
  const originalDev = __DEV__;
  const originalKey = process.env.EXPO_PUBLIC_GOOGLE_PLACES_KEY;
  const originalFetch = globalThis.fetch;
  const network = jest.fn();
  try {
    Object.defineProperty(globalThis, '__DEV__', {
      value: false,
      configurable: true,
      writable: true,
    });
    process.env.EXPO_PUBLIC_GOOGLE_PLACES_KEY = 'test-only-key';
    globalThis.fetch = network;
    let module!: typeof import('@/lib/googlePlaces');
    jest.isolateModules(() => {
      module = jest.requireActual('@/lib/googlePlaces');
    });
    expect(module.GOOGLE_ENABLED).toBe(false);
    expect(await module.lookupGoogle({ placeId: 'a' } as Candidate)).toBeNull();
    expect(await module.lookupDetails('a')).toBeNull();
    expect(network).not.toHaveBeenCalled();
  } finally {
    Object.defineProperty(globalThis, '__DEV__', {
      value: originalDev,
      configurable: true,
      writable: true,
    });
    if (originalKey === undefined) delete process.env.EXPO_PUBLIC_GOOGLE_PLACES_KEY;
    else process.env.EXPO_PUBLIC_GOOGLE_PLACES_KEY = originalKey;
    globalThis.fetch = originalFetch;
  }
});
