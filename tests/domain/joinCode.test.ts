import { JOIN_CODE_ALPHABET, normalizeJoinCode, parseJoinCode } from '@shared/domain/joinCode.ts';
import { joinPick, parseJoin } from '@shared/api/join.ts';
import { makeJoinCode } from '@/lib/mock/store';

test('the alphabet has 32 characters and no 0/O/1/I', () => {
  expect(JOIN_CODE_ALPHABET).toHaveLength(32);
  expect(JOIN_CODE_ALPHABET).not.toMatch(/[0O1I]/);
});

test('codes are case- and space-insensitive', () => {
  expect(normalizeJoinCode(' k7p 2qx\n')).toBe('K7P2QX');
  expect(parseJoinCode('k7p2qx')).toBe('K7P2QX');
});

test.each(['', 'K7P2Q', 'K7P2QXX', 'O0I1AB', 'K7P-2Q', 'K7P2Q!'])('rejects %p', (input) => {
  expect(parseJoinCode(input)).toBeNull();
});

test('the mock issues codes the server would accept', () => {
  for (let i = 0; i < 50; i++) expect(parseJoinCode(makeJoinCode())).not.toBeNull();
});

test('parseJoin needs an object with a code', () => {
  for (const body of [undefined, null, [], 'K7P2QX', {}, { code: 1 }, { code: 'x'.repeat(65) }]) {
    expect(() => parseJoin(body)).toThrow('Expected');
  }
});

test('joinPick passes the normalized code and returns { pickId }', async () => {
  const joinByCode = jest.fn().mockResolvedValue('pick-1');
  await expect(joinPick({ joinByCode }, 'guest', { code: 'k7p2qx' })).resolves.toEqual({
    pickId: 'pick-1',
  });
  expect(joinByCode).toHaveBeenCalledWith('K7P2QX', 'guest');
});
