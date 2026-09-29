// Pick lifecycle. Spec: docs/design.md#pick-state-machine (owner: Alan).
// The API is the only writer of picks.state and must call canTransition first.

export const PICK_STATES = [
  'draft',
  'swiping',
  'ranking',
  'final_vote',
  'completed',
  'canceled',
] as const;
export type PickState = (typeof PICK_STATES)[number];

/** Who is asking: the Pick's host, another participant, or the server itself (deadline/threshold sweeps). */
export type Actor = 'host' | 'participant' | 'system';

// from -> to -> actors allowed to trigger it. Anything not listed is illegal.
const TRANSITIONS: Readonly<Record<PickState, Partial<Record<PickState, readonly Actor[]>>>> = {
  draft: { swiping: ['host'], canceled: ['host', 'system'] },
  // host closes manually; system closes at the deadline or at the close threshold
  swiping: { ranking: ['host', 'system'], canceled: ['host', 'system'] },
  // ranking is computed by the server: clear winner -> completed, otherwise -> final_vote
  ranking: { final_vote: ['system'], completed: ['system'], canceled: ['host', 'system'] },
  final_vote: { completed: ['system'], canceled: ['host', 'system'] },
  completed: {},
  canceled: {},
};

export function canTransition(from: PickState, to: PickState, actor: Actor): boolean {
  return TRANSITIONS[from][to]?.includes(actor) ?? false;
}

export function isTerminal(state: PickState): boolean {
  return state === 'completed' || state === 'canceled';
}

/**
 * Should the system close the current phase? Yes at the deadline, or once at least
 * thresholdPct percent of the n participants are done.
 * swiping → ranking: done = finished swiping, thresholdPct = picks.close_threshold (default 100).
 * final_vote → completed: done = ballots cast, thresholdPct = 100.
 */
export function dueToClose(p: {
  done: number;
  n: number;
  thresholdPct: number;
  /** picks.deadline_at; null = no deadline, only the threshold closes it. */
  deadlineAt: Date | null;
  now: Date;
}): boolean {
  // integer math: 2 of 3 at a 67% threshold must not pass on float rounding
  return (p.deadlineAt !== null && p.now >= p.deadlineAt) || p.done * 100 >= p.thresholdPct * p.n;
}
