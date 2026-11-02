import { errorResponse } from '@shared/api/errors.ts';
import type { ProfileStore } from '@shared/api/profile.ts';

const mockUpsert = jest.fn();
const mockMaybeSingle = jest.fn();
const mockEq = jest.fn(() => ({ maybeSingle: mockMaybeSingle }));
const mockSelect = jest.fn(() => ({ eq: mockEq }));
const mockFrom = jest.fn(() => ({ upsert: mockUpsert, select: mockSelect }));
jest.mock('../supabase/functions/api/serviceClient.ts', () => ({
  createServiceClient: () => ({ from: mockFrom }),
}));
// Load the adapter with its Deno-only service client mocked, keeping app tsc separate.
const { createProfileStore } = jest.requireActual<{ createProfileStore(): ProfileStore }>(
  '../supabase/functions/api/profileStore.ts',
);

beforeEach(() => {
  mockUpsert.mockReset();
  mockMaybeSingle.mockReset();
  mockFrom.mockClear();
  mockSelect.mockClear();
  mockEq.mockClear();
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

test('reads only the caller’s row, including the private survey columns', async () => {
  mockMaybeSingle.mockResolvedValue({
    data: {
      display_name: 'Ava',
      discover_preferences: { priceMax: 2 },
      preferences_updated_at: '2026-10-30T12:00:00Z',
    },
    error: null,
  });
  await expect(createProfileStore().getProfile('user-1')).resolves.toEqual({
    displayName: 'Ava',
    preferences: { priceMax: 2 },
    preferencesUpdatedAt: '2026-10-30T12:00:00Z',
  });
  expect(mockSelect).toHaveBeenCalledWith(
    'display_name, discover_preferences, preferences_updated_at',
  );
  expect(mockEq).toHaveBeenCalledWith('id', 'user-1');
});

test('a missing row reads as null', async () => {
  mockMaybeSingle.mockResolvedValue({ data: null, error: null });
  await expect(createProfileStore().getProfile('user-1')).resolves.toBeNull();
});

test('saving preferences stamps preferences_updated_at on the caller’s row', async () => {
  mockUpsert.mockResolvedValue({ error: null });
  const preferences = {
    categories: [],
    types: ['cafe'],
    dislikedTypes: [],
    priceMax: null,
    maxDistanceM: null,
  };
  await createProfileStore().setPreferences('user-1', preferences);
  expect(mockUpsert).toHaveBeenCalledWith(
    expect.objectContaining({
      id: 'user-1',
      discover_preferences: preferences,
      preferences_updated_at: expect.any(String),
    }),
    { onConflict: 'id' },
  );
});
