import { shuffleForUser } from '@shared/domain/shuffle.ts';

const ids = Array.from({ length: 20 }, (_, i) => `place-${i}`);

describe('shuffleForUser', () => {
  test('keeps every id exactly once', () => {
    const shuffled = shuffleForUser(ids, 'pick-1', 'user-a');
    expect(shuffled).toHaveLength(ids.length);
    expect(new Set(shuffled)).toEqual(new Set(ids));
  });
  test('is stable for the same pick and user', () => {
    expect(shuffleForUser(ids, 'pick-1', 'user-a')).toEqual(
      shuffleForUser(ids, 'pick-1', 'user-a'),
    );
  });
  test('differs across users', () => {
    expect(shuffleForUser(ids, 'pick-1', 'user-a')).not.toEqual(
      shuffleForUser(ids, 'pick-1', 'user-b'),
    );
  });
  test('differs across picks for the same user', () => {
    expect(shuffleForUser(ids, 'pick-1', 'user-a')).not.toEqual(
      shuffleForUser(ids, 'pick-2', 'user-a'),
    );
  });
  test('is not merely the input order', () => {
    expect(shuffleForUser(ids, 'pick-1', 'user-a')).not.toEqual(ids);
  });
  test('handles 0 or 1 candidates without touching the PRNG', () => {
    expect(shuffleForUser([], 'pick-1', 'user-a')).toEqual([]);
    expect(shuffleForUser(['only'], 'pick-1', 'user-a')).toEqual(['only']);
  });
});
