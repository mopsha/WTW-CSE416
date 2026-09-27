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
