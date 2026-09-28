import { shouldRequestRank, viewFromDecision, viewFromStored } from '@/lib/results';
import type { PickOutcome, PickState } from '@/lib/types';

const outcome = (state: PickState, extra: Partial<PickOutcome> = {}): PickOutcome => ({
  state,
  hostId: 'host',
  winnerPlaceId: null,
  decidedBy: null,
  ...extra,
});

describe('shouldRequestRank', () => {
  test('only the host of a swiping Pick ranks', () => {
    expect(shouldRequestRank(outcome('swiping'), 'host')).toBe(true);
    expect(shouldRequestRank(outcome('swiping'), 'guest')).toBe(false);
  });

  test.each<PickState>(['draft', 'ranking', 'final_vote', 'completed', 'canceled'])(
    'never re-ranks a %s Pick',
    (state) => {
      expect(shouldRequestRank(outcome(state), 'host')).toBe(false);
    },
  );
});

describe('viewFromDecision', () => {
  test('winner is a clear winner', () => {
    expect(viewFromDecision({ kind: 'winner', winner: { placeId: 'a', rank: 1 } })).toEqual({
      kind: 'winner',
      placeId: 'a',
      clearWinner: true,
    });
  });

  test('vote keeps every finalist (ties beyond three) in rank order', () => {
    const finalists = [
      { placeId: 'c', rank: 3 },
      { placeId: 'a', rank: 1 },
      { placeId: 'd', rank: 4 },
      { placeId: 'b', rank: 2 },
    ];
    expect(viewFromDecision({ kind: 'vote', finalists })).toEqual({
      kind: 'vote',
      finalists: [
        { placeId: 'a', rank: 1 },
        { placeId: 'b', rank: 2 },
        { placeId: 'c', rank: 3 },
        { placeId: 'd', rank: 4 },
      ],
    });
  });
});

describe('viewFromStored', () => {
  test('non-host sees a waiting state while swiping or ranking', () => {
    expect(viewFromStored(outcome('swiping'), [])).toEqual({ kind: 'waiting', reason: 'host' });
    expect(viewFromStored(outcome('ranking'), [])).toEqual({ kind: 'waiting', reason: 'ranking' });
    expect(viewFromStored(outcome('draft'), [])).toEqual({
      kind: 'waiting',
      reason: 'not_started',
    });
  });

  test('canceled', () => {
    expect(viewFromStored(outcome('canceled'), [])).toEqual({ kind: 'canceled' });
  });

  test('stored winner; "Clear winner!" only when decided_by says so', () => {
    const won = outcome('completed', { winnerPlaceId: 'w', decidedBy: 'clear_winner' });
    expect(viewFromStored(won, [])).toEqual({ kind: 'winner', placeId: 'w', clearWinner: true });
    const voted = outcome('completed', { winnerPlaceId: 'w', decidedBy: 'vote' });
    expect(viewFromStored(voted, [])).toEqual({ kind: 'winner', placeId: 'w', clearWinner: false });
  });

  test('final vote shows flagged finalists in rank order, without scores', () => {
    const ranking = [
      { placeId: 'x', rank: 4, finalist: false },
      { placeId: 'b', rank: 2, finalist: true },
      { placeId: 'a', rank: 1, finalist: true },
      { placeId: 'c', rank: 3, finalist: true },
    ];
    expect(viewFromStored(outcome('final_vote'), ranking)).toEqual({
      kind: 'vote',
      finalists: [
        { placeId: 'a', rank: 1 },
        { placeId: 'b', rank: 2 },
        { placeId: 'c', rank: 3 },
      ],
    });
  });

  test('falls back to the top three when no finalist flags are stored', () => {
    const ranking = [4, 1, 3, 2].map((rank) => ({ placeId: `p${rank}`, rank, finalist: false }));
    const view = viewFromStored(outcome('final_vote'), ranking);
    expect(view).toEqual({
      kind: 'vote',
      finalists: [
        { placeId: 'p1', rank: 1 },
        { placeId: 'p2', rank: 2 },
        { placeId: 'p3', rank: 3 },
      ],
    });
  });

  test('empty when nothing has been stored yet', () => {
    expect(viewFromStored(outcome('final_vote'), [])).toEqual({ kind: 'empty' });
  });
});
