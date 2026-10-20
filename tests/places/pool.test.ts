import { createPoolBuilder } from '@shared/places/pool.ts';
import { MockProvider } from '@shared/places/MockProvider.ts';
import type { PlaceProvider } from '@shared/places/types.ts';

const center = { lat: 40.9126, lng: -73.1234 };

test('dedupes, sorts nearest-first, and caps at poolSize', async () => {
  const pool = createPoolBuilder(new MockProvider());
  const result = await pool.buildPool({ center, radiusM: 10000, category: 'food', poolSize: 1 });
  expect(result.map((c) => c.placeId)).toEqual(['placeholder-cafe']);
});

test('rejects a non-positive poolSize', async () => {
  const pool = createPoolBuilder(new MockProvider());
  await expect(
    pool.buildPool({ center, radiusM: 1, category: 'food', poolSize: 0 }),
  ).rejects.toThrow(RangeError);
});

test('dedupes a provider that returns the same place twice', async () => {
  const duplicate = { placeId: 'x', name: 'X', category: 'food' as const, ...center };
  const provider: PlaceProvider = { search: async () => [duplicate, duplicate] };
  const pool = createPoolBuilder(provider);
  const result = await pool.buildPool({ center, radiusM: 10, category: 'food', poolSize: 10 });
  expect(result).toHaveLength(1);
});
