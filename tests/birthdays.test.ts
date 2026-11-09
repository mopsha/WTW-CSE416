import { parseBirthday, birthdayLabel, sameBirthday } from '@shared/api/birthdays.ts';
import { parseIdentity, parseProfileDetails } from '@shared/api/userProfiles.ts';
import { getMe, type ProfileStore } from '@shared/api/profile.ts';

test.each([
  { month: 2, day: 29 },
  { month: 6, day: 15 },
  { month: 12, day: 31 },
  { month: 4, day: 30 },
])('valid recurring month/day %p is preserved without a year', (value) => {
  expect(parseBirthday(value)).toEqual(value);
  expect(Object.keys(parseBirthday(value)!)).toEqual(['month', 'day']);
});
test.each([
  { month: 2, day: 30 },
  { month: 4, day: 31 },
  { month: 0, day: 1 },
  { month: 13, day: 1 },
  { month: 1, day: 0 },
  { month: 1, day: 32 },
  { month: 1.5, day: 2 },
  { month: 2, day: 1.5 },
  { month: '2', day: 29 },
  { month: 2 },
  { day: 2 },
  {},
  { month: 2, day: 29, year: 2000 },
  '2000-02-29',
  '02-29',
  [],
  undefined,
  NaN,
])('invalid or year-bearing birthday %p is rejected', (value) => {
  expect(() => parseBirthday(value)).toThrow('birthday');
});
test('null remains valid for existing accounts and a birthday is never compared to today', () => {
  expect(parseBirthday(null)).toBeNull();
  expect(parseBirthday({ month: 12, day: 31 })).toEqual({ month: 12, day: 31 });
  expect(birthdayLabel({ month: 2, day: 29 })).toBe('February 29');
  expect(sameBirthday({ month: 2, day: 29 }, { day: 29, month: 2 })).toBe(true);
});
test('privacy is opt-in and omitted birthday fields preserve stored month/day', () => {
  expect(parseProfileDetails({ username: 'ava', shareMetadata: false })).not.toHaveProperty(
    'birthday',
  );
  expect(parseProfileDetails({ username: 'ava', shareMetadata: false })).not.toHaveProperty(
    'shareBirthday',
  );
  expect(
    parseIdentity({ displayName: 'Ava', username: 'ava', birthday: { month: 2, day: 29 } }),
  ).toEqual({ displayName: 'Ava', username: 'ava', birthday: { month: 2, day: 29 } });
  expect(() =>
    parseProfileDetails({ shareMetadata: false, shareBirthday: true, birthday: null }),
  ).toThrow('before sharing');
  expect(() => parseProfileDetails({ shareMetadata: false, shareBirthday: 'true' })).toThrow(
    'whether',
  );
  for (const field of ['birthDate', 'birthYear', 'year'])
    expect(() => parseProfileDetails({ shareMetadata: false, [field]: '2000-02-29' })).toThrow(
      'month and day only',
    );
});
test('new accounts remain incomplete without birthday; existing accounts stay exempt', async () => {
  const getProfile = jest
    .fn()
    .mockResolvedValue({
      displayName: 'Ava',
      username: 'ava',
      preferencesUpdatedAt: '2026-01-01',
      birthdayRequired: true,
    });
  const store = { getProfile } as unknown as ProfileStore;
  expect(await getMe(store, 'me')).toMatchObject({ onboarded: false, birthdayRequired: true });
  getProfile.mockResolvedValue({
    displayName: 'Legacy',
    username: 'legacy',
    preferencesUpdatedAt: '2026-01-01',
  });
  expect(await getMe(store, 'me')).toMatchObject({ onboarded: true });
  expect(await getMe(store, 'me')).not.toHaveProperty('birthday');
});
