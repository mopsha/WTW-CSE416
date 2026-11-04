import { parseAvatarRevision } from '@shared/api/avatars.ts';

test.each(['0', '1', '123456'])('accepts a canonical revision %s', (value) => {
  expect(parseAvatarRevision(value)).toBe(Number(value));
});
test.each([undefined, null, -1, '01', '-1', '1.5', '1e3', '9999999999999999', ''])(
  'rejects invalid revision %p',
  (value) => {
    expect(() => parseAvatarRevision(value)).toThrow();
  },
);
