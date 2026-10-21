import { errorResponse } from '@shared/api/errors.ts';
import {
  DISPLAY_NAME_MAX,
  parseProfileUpdate,
  updateMe,
  validateDisplayName,
} from '@shared/api/profile.ts';

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
  await expect(updateMe({ setDisplayName }, 'me', { displayName: ' Ava ' })).resolves.toEqual({
    displayName: 'Ava',
  });
  expect(setDisplayName).toHaveBeenCalledWith('me', 'Ava');
});

test('updateMe does not write an invalid name', async () => {
  const setDisplayName = jest.fn(async () => {});
  await expect(updateMe({ setDisplayName }, 'me', { displayName: '' })).rejects.toThrow();
  expect(setDisplayName).not.toHaveBeenCalled();
});
