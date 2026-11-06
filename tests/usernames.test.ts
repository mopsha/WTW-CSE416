import { normalizeUsername } from '@shared/api/usernames.ts';
import {
  hasRequiredIdentity,
  parseIdentity,
  parseProfileDetails,
} from '@shared/api/userProfiles.ts';
test('onboarding, editing, and search share canonical username syntax', () => {
  expect(normalizeUsername(' @AVA_ONE ')).toBe('ava_one');
  expect(parseIdentity({ displayName: 'Ava', username: '@AVA_ONE' }).username).toBe('ava_one');
  expect(parseProfileDetails({ username: '@AVA_ONE', shareMetadata: false }).username).toBe(
    'ava_one',
  );
  expect(normalizeUsername('@AVA', true)).toBe('ava');
  expect(hasRequiredIdentity('Ava', null)).toBe(false);
  expect(hasRequiredIdentity('Ava', 'ava_one')).toBe(true);
});
test.each(['', '   ', 'ab', 'not allowed', 'ava@email.com', 'admin', '@SUPPORT', 'a'.repeat(25)])(
  'invalid/reserved username %p is rejected',
  (value) => expect(() => normalizeUsername(value)).toThrow(),
);

test('only the unchanged verified current reserved name is grandfathered', () => {
  expect(parseProfileDetails({ username: '@ADMIN', shareMetadata: false }, 'admin').username).toBe(
    'admin',
  );
  expect(() => parseProfileDetails({ username: 'admin', shareMetadata: false }, 'someone')).toThrow(
    'reserved',
  );
  expect(() => parseProfileDetails({ username: 'support', shareMetadata: false }, 'admin')).toThrow(
    'reserved',
  );
  expect(() => parseIdentity({ displayName: 'New', username: 'admin' })).toThrow('reserved');
});

test('unchanged legacy syntax is preserved, but new claims remain invalid', () => {
  expect(normalizeUsername('legacy-name', false, 'legacy-name')).toBe('legacy-name');
  expect(() => normalizeUsername('legacy-name')).toThrow();
  expect(() => normalizeUsername('another-name', false, 'legacy-name')).toThrow();
});
