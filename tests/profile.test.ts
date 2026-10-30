import { errorResponse } from '@shared/api/errors.ts';
import {
  DISPLAY_NAME_MAX,
  getMe,
  parseProfileUpdate,
  updateMe,
  updatePreferences,
  validateDisplayName,
  type ProfileStore,
} from '@shared/api/profile.ts';
import { EMPTY_PREFERENCES } from '@shared/domain/preferences.ts';

function storeWith(overrides: Partial<ProfileStore>): ProfileStore {
  return {
    setDisplayName: jest.fn(async () => {}),
    getProfile: jest.fn(async () => null),
    setPreferences: jest.fn(async () => {}),
    ...overrides,
  };
}

describe('validateDisplayName', () => {
  test('trims and accepts 1 to 50 characters', () => {
    expect(validateDisplayName('  Ava  ')).toEqual({ name: 'Ava' });
    expect(validateDisplayName('a')).toEqual({ name: 'a' });
    expect(validateDisplayName('a'.repeat(DISPLAY_NAME_MAX))).toEqual({
      name: 'a'.repeat(DISPLAY_NAME_MAX),
    });
  });

  test('counts characters like Postgres char_length, not UTF-16 units', () => {
    // 50 emoji are 100 UTF-16 units but 50 characters, which the column check accepts.
    expect(validateDisplayName('🔥'.repeat(50))).toEqual({ name: '🔥'.repeat(50) });
    expect(validateDisplayName('🔥'.repeat(51))).toHaveProperty('error');
  });

  test.each([
    undefined,
    null,
    42,
    '',
    '   ',
    'a'.repeat(51),
    'two\nlines',
    'tab\there',
    'nul\u0000',
  ])('rejects %p', (value) => {
    expect(validateDisplayName(value)).toHaveProperty('error');
  });
});

describe('parseProfileUpdate', () => {
  test.each([undefined, null, [], 'Ava', {}])('rejects body %p with 400 INVALID_INPUT', (body) => {
    const response = errorResponse(
      (() => {
        try {
          parseProfileUpdate(body);
        } catch (e) {
          return e;
        }
      })(),
    );
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_INPUT');
  });
});

test('updateMe writes the trimmed name for the given user and returns it', async () => {
  const setDisplayName = jest.fn(async () => {});
  await expect(
    updateMe(storeWith({ setDisplayName }), 'me', { displayName: ' Ava ' }),
  ).resolves.toEqual({
    displayName: 'Ava',
  });
  expect(setDisplayName).toHaveBeenCalledWith('me', 'Ava');
});

test('updateMe does not write an invalid name', async () => {
  const setDisplayName = jest.fn(async () => {});
  await expect(
    updateMe(storeWith({ setDisplayName }), 'me', { displayName: '' }),
  ).rejects.toThrow();
  expect(setDisplayName).not.toHaveBeenCalled();
});

describe('getMe', () => {
  test('a missing row reads as a new account', async () => {
    await expect(getMe(storeWith({}), 'me')).resolves.toEqual({
      displayName: null,
      preferences: EMPTY_PREFERENCES,
      onboarded: false,
    });
  });

  test('returns my trimmed name, cleaned preferences, and onboarded once saved', async () => {
    const getProfile = jest.fn(async () => ({
      displayName: '  Ava ',
      preferences: { types: ['cafe', 'casino'], priceMax: 2 },
      preferencesUpdatedAt: '2026-10-30T12:00:00Z',
    }));
    await expect(getMe(storeWith({ getProfile }), 'me')).resolves.toEqual({
      displayName: 'Ava',
      // casino isn't an option, so the whole stored list reads as unset.
      preferences: { ...EMPTY_PREFERENCES, priceMax: 2 },
      onboarded: true,
    });
    expect(getProfile).toHaveBeenCalledWith('me');
  });
});

describe('updatePreferences', () => {
  test('saves valid answers for the given user and reports onboarded', async () => {
    const setPreferences = jest.fn(async () => {});
    const preferences = { ...EMPTY_PREFERENCES, categories: ['food'], priceMax: 3 };
    await expect(
      updatePreferences(storeWith({ setPreferences }), 'me', { preferences }),
    ).resolves.toEqual({ preferences, onboarded: true });
    expect(setPreferences).toHaveBeenCalledWith('me', preferences);
  });

  test.each([undefined, null, [], {}, { preferences: { priceMax: 7 } }])(
    'rejects body %p with 400 and writes nothing',
    async (body) => {
      const setPreferences = jest.fn(async () => {});
      const error = await updatePreferences(storeWith({ setPreferences }), 'me', body).catch(
        (e: unknown) => e,
      );
      expect(errorResponse(error).status).toBe(400);
      expect(setPreferences).not.toHaveBeenCalled();
    },
  );
});
