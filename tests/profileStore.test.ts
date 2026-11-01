import { errorResponse } from '@shared/api/errors.ts';
import type { ProfileStore } from '@shared/api/profile.ts';

const mockUpsert = jest.fn();
const mockFrom = jest.fn(() => ({ upsert: mockUpsert }));
jest.mock('../supabase/functions/api/serviceClient.ts', () => ({
  createServiceClient: () => ({ from: mockFrom }),
}));
// Load the adapter with its Deno-only service client mocked, keeping app tsc separate.
const { createProfileStore } = jest.requireActual<{ createProfileStore(): ProfileStore }>(
  '../supabase/functions/api/profileStore.ts',
);

beforeEach(() => {
  mockUpsert.mockReset();
  mockFrom.mockClear();
});

test('upserts display_name on the caller’s own profile row', async () => {
  mockUpsert.mockResolvedValue({ error: null });
  await createProfileStore().setDisplayName('user-1', 'Ava');
  expect(mockFrom).toHaveBeenCalledWith('profiles');
  expect(mockUpsert).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'user-1', display_name: 'Ava' }),
    { onConflict: 'id' },
  );
});

test('database errors become a 500 without leaking details', async () => {
  mockUpsert.mockResolvedValue({ error: { code: 'XX000', message: 'secret DB details' } });
  const error = await createProfileStore()
    .setDisplayName('user-1', 'Ava')
    .catch((e: unknown) => e);
  const response = errorResponse(error);
  expect(response.status).toBe(500);
  expect(JSON.stringify(response)).not.toContain('secret DB details');
});
