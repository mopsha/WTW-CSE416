import { dueToClose } from '@shared/domain/pickState.ts';
import { voteWinner, type RankedCandidate } from '@shared/domain/ranking.ts';

const finalist = (placeId: string, rank: number): RankedCandidate => ({
  placeId,
  rank,
  distanceM: 0,
  score: 70 - rank,
  preference: 0,
  consensus: 0,
  coverage: 0,
  noProportion: 0,
});
const top3 = [finalist('a', 1), finalist('b', 2), finalist('c', 3)];

describe('voteWinner', () => {
  test('most votes wins, even from a lower rank', () => {
    expect(voteWinner(top3, ['c', 'c', 'a']).placeId).toBe('c');
  });
  test('tied votes go to the better rank (score, then distance, then id)', () => {
    expect(voteWinner(top3, ['c', 'b', 'b', 'c']).placeId).toBe('b');
  });
  test('no ballots: #1 wins', () => {
    expect(voteWinner(top3, []).placeId).toBe('a');
  });
  test('rejects a vote for a non-finalist and an empty field', () => {
    expect(() => voteWinner(top3, ['z'])).toThrow(RangeError);
    expect(() => voteWinner([], [])).toThrow(RangeError);
  });
});

describe('dueToClose', () => {
  const deadlineAt = new Date('2026-10-01T18:00:00Z');
  const before = new Date('2026-10-01T17:00:00Z');
  test('closes at the deadline even if nobody is done', () => {
    expect(dueToClose({ done: 0, n: 4, thresholdPct: 100, deadlineAt, now: deadlineAt })).toBe(
      true,
    );
  });
  test('default 100%: everyone must be done', () => {
    expect(dueToClose({ done: 3, n: 4, thresholdPct: 100, deadlineAt, now: before })).toBe(false);
    expect(dueToClose({ done: 4, n: 4, thresholdPct: 100, deadlineAt, now: before })).toBe(true);
  });
  test('no deadline: only the threshold closes it', () => {
    expect(dueToClose({ done: 3, n: 4, thresholdPct: 100, deadlineAt: null, now: before })).toBe(
      false,
    );
    expect(dueToClose({ done: 4, n: 4, thresholdPct: 100, deadlineAt: null, now: before })).toBe(
      true,
    );
  });
  test('threshold boundary is inclusive and exact', () => {
    expect(dueToClose({ done: 3, n: 4, thresholdPct: 75, deadlineAt, now: before })).toBe(true);
    expect(dueToClose({ done: 2, n: 3, thresholdPct: 67, deadlineAt, now: before })).toBe(false);
    expect(dueToClose({ done: 2, n: 3, thresholdPct: 66, deadlineAt, now: before })).toBe(true);
  });
});
