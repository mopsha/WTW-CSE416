// Which Pick screen belongs to which Pick state. Every Pick screen calls usePickRoute with
// this, so when the state changes (the host closes, the deadline passes, the vote settles)
// everyone moves on without restarting the app, and a late arrival lands on the current step.
import type { PickState } from './types';

export type PickScreen =
  | 'lobby'
  | 'swipe'
  | 'waiting'
  | 'results'
  | 'vote'
  | 'winner'
  /** app/pick/[id]/index: loading, canceled, not found, offline. */
  | 'index';

/** Screens allowed in each state. The first one is where a fresh arrival goes. */
const ALLOWED: Record<PickState, readonly PickScreen[]> = {
  draft: ['lobby'],
  swiping: ['swipe', 'waiting'],
  ranking: ['results'],
  // Results first reveals the ranking; a late arrival goes straight to the ballot.
  final_vote: ['vote', 'results'],
  completed: ['winner', 'results'],
  canceled: ['index'],
};

/**
 * Where a fresh arrival should go: `swiping` sends people who have answered everything to the
 * waiting view instead of an empty deck.
 */
export function screenForState(state: PickState, opts: { allAnswered?: boolean } = {}): PickScreen {
  if (state === 'swiping') return opts.allAnswered ? 'waiting' : 'swipe';
  return ALLOWED[state][0]!;
}

/**
 * Null when `current` may stay on screen in `state`; otherwise the screen to replace it with.
 * `from` is the state the screen was showing before, so a Pick that just closed while someone
 * was swiping or waiting goes to the reveal (results) rather than skipping it.
 */
export function redirectFor(
  current: PickScreen,
  state: PickState,
  opts: { allAnswered?: boolean; from?: PickState | null } = {},
): PickScreen | null {
  if (ALLOWED[state].includes(current)) return null;
  const justClosed = opts.from === 'swiping' || opts.from === 'ranking';
  if (justClosed && (state === 'final_vote' || state === 'completed')) return 'results';
  return screenForState(state, opts);
}

export function pathFor(screen: PickScreen) {
  return screen === 'index' ? ('/pick/[id]' as const) : (`/pick/[id]/${screen}` as const);
}
