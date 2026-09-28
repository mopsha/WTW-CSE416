// WTW ranking engine. Spec: docs/design.md#scoring (owner: Alan).
// Pure TypeScript: no Deno / React Native imports, explicit .ts extensions.

import { distanceMeters, type LatLng } from './geo.ts';

export type Answer = 'yes' | 'maybe' | 'no';

/** Utility of each answer. A missing answer counts as Maybe. */
export const ANSWER_VALUE: Readonly<Record<Answer, number>> = { yes: 1, maybe: 0.5, no: 0 };
const MISSING_VALUE = ANSWER_VALUE.maybe;

/** preferences.value in the database: 0 = No, 1 = Maybe, 2 = Yes. */
export function answerFromDb(value: number): Answer {
  if (value === 0) return 'no';
  if (value === 1) return 'maybe';
  if (value === 2) return 'yes';
  throw new RangeError(`invalid preference value: ${value}`);
}

/** Minimum score gap for #1 to win without a final vote. */
export const CLEAR_WINNER_MARGIN = 10;

// Scores are floats; treat differences below this as equal so float noise
// never decides a tie or the clear-winner margin.
const EPSILON = 1e-9;

export interface ScoreBreakdown {
  score: number;
  preference: number;
  consensus: number;
  coverage: number;
  noProportion: number;
}

/**
 * Score one candidate from the answers actually given for it.
 * @param answers answers given for this candidate (at most one per participant)
 * @param n       number of participants in the Pick; unanswered slots count as Maybe
 */
export function scoreCandidate(answers: readonly Answer[], n: number): ScoreBreakdown {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`n must be a positive integer, got ${n}`);
  if (answers.length > n) {
    throw new RangeError(`${answers.length} answers for ${n} participants`);
  }

  const values = answers.map((a) => ANSWER_VALUE[a]);
  while (values.length < n) values.push(MISSING_VALUE);

  const preference = values.reduce((sum, v) => sum + v, 0) / n;
  const variance = values.reduce((sum, v) => sum + (v - preference) ** 2, 0) / n;
  const consensus = 1 - Math.sqrt(variance) / 0.5;
  const coverage = answers.length / n;
  const noProportion = answers.filter((a) => a === 'no').length / n;

  const raw = 100 * (0.7 * preference + 0.2 * consensus + 0.1 * coverage) - 15 * noProportion;
  const score = Math.min(100, Math.max(0, raw));
  return { score, preference, consensus, coverage, noProportion };
}

export interface RankCandidate extends LatLng {
  placeId: string;
}

export interface CandidateAnswer {
  placeId: string;
  answer: Answer;
}

export interface RankedCandidate extends ScoreBreakdown {
  placeId: string;
  /** 1-based position after tie-breaks. The only thing users see. */
  rank: number;
  distanceM: number;
}

/**
 * Rank every candidate in a Pick.
 * Order: score desc → distance to the Pick center asc → placeId asc.
 * Answers for places not in `candidates` are ignored.
 */
export function rankCandidates(
  candidates: readonly RankCandidate[],
  answers: readonly CandidateAnswer[],
  n: number,
  center: LatLng,
): RankedCandidate[] {
  const byPlace = new Map<string, Answer[]>();
  for (const c of candidates) byPlace.set(c.placeId, []);
  for (const a of answers) byPlace.get(a.placeId)?.push(a.answer);

  const scored = candidates.map((c) => ({
    placeId: c.placeId,
    distanceM: distanceMeters(center, c),
    ...scoreCandidate(byPlace.get(c.placeId) ?? [], n),
  }));

  scored.sort((a, b) => {
    if (Math.abs(a.score - b.score) > EPSILON) return b.score - a.score;
    if (a.distanceM !== b.distanceM) return a.distanceM - b.distanceM;
    return a.placeId < b.placeId ? -1 : a.placeId > b.placeId ? 1 : 0;
  });

  return scored.map((c, i) => ({ ...c, rank: i + 1 }));
}

export type Decision =
  { kind: 'winner'; winner: RankedCandidate } | { kind: 'vote'; finalists: RankedCandidate[] };

/**
 * Decide whether the group needs a final vote.
 * Clear winner: only one candidate, or #1 beats #2 by >= CLEAR_WINNER_MARGIN.
 * Otherwise the finalists are the top 3, plus anyone tied with #1 beyond that.
 * @param ranked output of rankCandidates (already sorted)
 */
export function clearWinner(ranked: readonly RankedCandidate[]): Decision {
  const [first, second] = ranked;
  if (!first) throw new RangeError('cannot decide a Pick with no candidates');
  if (!second || first.score - second.score >= CLEAR_WINNER_MARGIN - EPSILON) {
    return { kind: 'winner', winner: first };
  }
  const finalists = ranked.filter((c, i) => i < 3 || Math.abs(c.score - first.score) <= EPSILON);
  return { kind: 'vote', finalists };
}

/**
 * Winner of the final vote. Spec tie-break: most votes → higher score → closer → place id.
 * After the vote count that is exactly rankCandidates' order, so ties go to the better rank.
 * No ballots at all (deadline passed) means #1 wins.
 * @param finalists decision.finalists from clearWinner
 * @param votes     the placeId of every ballot cast
 */
export function voteWinner(
  finalists: readonly RankedCandidate[],
  votes: readonly string[],
): RankedCandidate {
  const tally = new Map(finalists.map((c) => [c.placeId, 0]));
  for (const placeId of votes) {
    const count = tally.get(placeId);
    if (count === undefined) throw new RangeError(`vote for non-finalist ${placeId}`);
    tally.set(placeId, count + 1);
  }
  const [winner] = [...finalists].sort(
    (a, b) => (tally.get(b.placeId) ?? 0) - (tally.get(a.placeId) ?? 0) || a.rank - b.rank,
  );
  if (!winner) throw new RangeError('cannot decide a vote with no finalists');
  return winner;
}
