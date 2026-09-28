import { firstUnansweredIndex } from '@/lib/resume';

const ids = ['a', 'b', 'c', 'd', 'e'];

describe('firstUnansweredIndex', () => {
  test('starts at the first card when nothing is answered', () => {
    expect(firstUnansweredIndex(ids, new Set())).toBe(0);
  });

  test('resumes after a prefix of answers', () => {
    expect(firstUnansweredIndex(ids, new Set(['a', 'b']))).toBe(2);
  });

  test('resumes at a gap, not after the last answer', () => {
    expect(firstUnansweredIndex(ids, new Set(['a', 'c', 'd']))).toBe(1);
  });

  test('returns length when everything is answered', () => {
    expect(firstUnansweredIndex(ids, new Set(ids))).toBe(ids.length);
  });

  test('skips already-answered cards when searching from a position', () => {
    expect(firstUnansweredIndex(ids, new Set(['a', 'c', 'd']), 2)).toBe(4);
  });

  test('ignores answers for places that are not candidates', () => {
    expect(firstUnansweredIndex(ids, new Set(['zzz']))).toBe(0);
  });

  test('handles an empty pool and out-of-range starts', () => {
    expect(firstUnansweredIndex([], new Set())).toBe(0);
    expect(firstUnansweredIndex(ids, new Set(), -3)).toBe(0);
    expect(firstUnansweredIndex(ids, new Set(), 99)).toBe(ids.length);
  });
});
