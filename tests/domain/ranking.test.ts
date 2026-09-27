import {
  answerFromDb,
  clearWinner,
  rankCandidates,
  scoreCandidate,
  type Answer,
  type CandidateAnswer,
  type RankedCandidate,
} from '../../supabase/functions/_shared/domain/ranking.ts';

const CENTER = { lat: 40.9126, lng: -73.1234 }; // SBU Academic Mall
const near = { lat: 40.913, lng: -73.1234 }; // ~45 m from center
const far = { lat: 40.93, lng: -73.1234 }; // ~1.9 km from center

const times = (n: number, a: Answer): Answer[] => Array<Answer>(n).fill(a);
const answersFor = (placeId: string, list: Answer[]): CandidateAnswer[] =>
  list.map((answer) => ({ placeId, answer }));

describe('scoreCandidate', () => {
  test('3 Yes + 1 No = 61.4 (spec worked example)', () => {
    expect(scoreCandidate([...times(3, 'yes'), 'no'], 4).score).toBeCloseTo(61.4, 1);
  });

  test('4 Maybe = 65.0 (spec worked example)', () => {
    expect(scoreCandidate(times(4, 'maybe'), 4).score).toBeCloseTo(65.0, 1);
  });

  test('missing answers count as Maybe; only coverage drops', () => {
    const allMaybe = scoreCandidate(times(4, 'maybe'), 4);
    const oneMissing = scoreCandidate(times(3, 'maybe'), 4);
    expect(oneMissing.preference).toBe(allMaybe.preference);
    expect(oneMissing.consensus).toBe(allMaybe.consensus);
    expect(oneMissing.coverage).toBe(0.75);
    expect(oneMissing.score).toBeCloseTo(62.5, 5);
  });

  test('nobody answered = 55 (all Maybe, zero coverage)', () => {
    expect(scoreCandidate([], 3).score).toBeCloseTo(55, 5);
  });

  test('all No = 15 (full agreement, full coverage, -15 penalty)', () => {
    expect(scoreCandidate(times(4, 'no'), 4).score).toBeCloseTo(15, 5);
  });

  test('single participant: Yes = 100, No = 15', () => {
    expect(scoreCandidate(['yes'], 1).score).toBeCloseTo(100, 5);
    expect(scoreCandidate(['no'], 1).score).toBeCloseTo(15, 5);
  });

  test('10 participants: 7 Yes, 2 Maybe, 1 No = 71.23', () => {
    const s = scoreCandidate([...times(7, 'yes'), ...times(2, 'maybe'), 'no'], 10);
    expect(s.preference).toBeCloseTo(0.8, 10);
    expect(s.noProportion).toBeCloseTo(0.1, 10);
    expect(s.score).toBeCloseTo(71.23, 2);
  });

  test('score always stays within 0-100', () => {
    const all: Answer[] = ['yes', 'maybe', 'no'];
    for (const a of all) for (const b of all) for (const c of all) {
      const { score } = scoreCandidate([a, b, c], 3);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  test('rejects bad participant counts', () => {
    expect(() => scoreCandidate([], 0)).toThrow(RangeError);
    expect(() => scoreCandidate(['yes', 'yes'], 1)).toThrow(RangeError);
  });
});

describe('answerFromDb', () => {
  test('maps 0/1/2 to No/Maybe/Yes and rejects anything else', () => {
    expect([0, 1, 2].map(answerFromDb)).toEqual(['no', 'maybe', 'yes']);
    expect(() => answerFromDb(3)).toThrow(RangeError);
  });
});

describe('rankCandidates', () => {
  test('sorts by score and numbers ranks 1..k', () => {
    const ranked = rankCandidates(
      [
        { placeId: 'low', ...near },
        { placeId: 'high', ...near },
      ],
      [...answersFor('low', times(2, 'no')), ...answersFor('high', times(2, 'yes'))],
      2,
      CENTER,
    );
    expect(ranked.map((r) => [r.placeId, r.rank])).toEqual([
      ['high', 1],
      ['low', 2],
    ]);
  });

  test('equal scores: closer to the center wins', () => {
    const ranked = rankCandidates(
      [
        { placeId: 'a-far', ...far },
        { placeId: 'z-near', ...near },
      ],
      [...answersFor('a-far', ['yes', 'no']), ...answersFor('z-near', ['yes', 'no'])],
      2,
      CENTER,
    );
    expect(ranked.map((r) => r.placeId)).toEqual(['z-near', 'a-far']);
    expect(ranked[0]!.distanceM).toBeLessThan(ranked[1]!.distanceM);
  });

  test('equal score and distance: place id decides', () => {
    const ranked = rankCandidates(
      [
        { placeId: 'b', ...near },
        { placeId: 'a', ...near },
      ],
      [],
      2,
      CENTER,
    );
    expect(ranked.map((r) => r.placeId)).toEqual(['a', 'b']);
  });

  test('ignores answers for places outside the pool', () => {
    const ranked = rankCandidates(
      [{ placeId: 'a', ...near }],
      answersFor('ghost', ['no']),
      1,
      CENTER,
    );
    expect(ranked[0]!.coverage).toBe(0);
  });
});

// Build ranked rows with chosen scores to probe the clear-winner rule directly.
const withScores = (...scores: number[]): RankedCandidate[] =>
  scores.map((score, i) => ({
    placeId: `p${i + 1}`,
    rank: i + 1,
    distanceM: 0,
    score,
    preference: 0,
    consensus: 0,
    coverage: 0,
    noProportion: 0,
  }));

describe('clearWinner', () => {
  test('#1 ahead by 10 or more is a clear winner', () => {
    const d = clearWinner(withScores(80, 70, 50));
    expect(d).toEqual({ kind: 'winner', winner: expect.objectContaining({ placeId: 'p1' }) });
  });

  test('margin of exactly 10 survives float noise', () => {
    // In floating point (6.4 + 10) - 6.4 === 9.999999999999998; that is still a 10-point gap.
    const second = 64 * 0.1;
    expect(second + 10 - second).toBeLessThan(10);
    expect(clearWinner(withScores(second + 10, second)).kind).toBe('winner');
  });

  test('#1 ahead by less than 10 goes to a vote among the top 3', () => {
    const d = clearWinner(withScores(80, 75, 70, 60, 50));
    expect(d.kind).toBe('vote');
    if (d.kind === 'vote') expect(d.finalists.map((f) => f.placeId)).toEqual(['p1', 'p2', 'p3']);
  });

  test('a tie at #1 is never a clear winner; everyone tied is a finalist', () => {
    const d = clearWinner(withScores(80, 80, 80, 80, 50));
    expect(d.kind).toBe('vote');
    if (d.kind === 'vote') expect(d.finalists).toHaveLength(4);
  });

  test('fewer than 3 candidates: vote among the 2', () => {
    const d = clearWinner(withScores(70, 65));
    expect(d.kind).toBe('vote');
    if (d.kind === 'vote') expect(d.finalists).toHaveLength(2);
  });

  test('only one candidate is a clear winner', () => {
    expect(clearWinner(withScores(20)).kind).toBe('winner');
  });

  test('no candidates is an error', () => {
    expect(() => clearWinner([])).toThrow(RangeError);
  });

  test('end to end: 4 Yes beats 3 Yes + 1 No by more than 10', () => {
    const ranked = rankCandidates(
      [
        { placeId: 'split', ...near },
        { placeId: 'loved', ...near },
      ],
      [
        ...answersFor('loved', times(4, 'yes')),
        ...answersFor('split', [...times(3, 'yes'), 'no']),
      ],
      4,
      CENTER,
    );
    const d = clearWinner(ranked);
    expect(d.kind === 'winner' && d.winner.placeId).toBe('loved');
  });
});
