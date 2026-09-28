import {
  PICK_STATES,
  canTransition,
  isTerminal,
  type Actor,
  type PickState,
} from '../../supabase/functions/_shared/domain/pickState.ts';

const ACTORS: Actor[] = ['host', 'participant', 'system'];

describe('canTransition', () => {
  test('happy path with a final vote', () => {
    expect(canTransition('draft', 'swiping', 'host')).toBe(true);
    expect(canTransition('swiping', 'ranking', 'host')).toBe(true);
    expect(canTransition('ranking', 'final_vote', 'system')).toBe(true);
    expect(canTransition('final_vote', 'completed', 'system')).toBe(true);
  });

  test('clear winner skips the vote; deadline/threshold closes as system', () => {
    expect(canTransition('swiping', 'ranking', 'system')).toBe(true);
    expect(canTransition('ranking', 'completed', 'system')).toBe(true);
  });

  test('participants can never change the state', () => {
    for (const from of PICK_STATES) for (const to of PICK_STATES) {
      expect(canTransition(from, to, 'participant')).toBe(false);
    }
  });

  test('only the host starts a Pick; host cannot decide the outcome', () => {
    expect(canTransition('draft', 'swiping', 'system')).toBe(false);
    expect(canTransition('ranking', 'completed', 'host')).toBe(false);
    expect(canTransition('final_vote', 'completed', 'host')).toBe(false);
  });

  test('no skipping ahead or going backwards', () => {
    const illegal: [PickState, PickState][] = [
      ['draft', 'ranking'],
      ['draft', 'completed'],
      ['swiping', 'final_vote'],
      ['swiping', 'completed'],
      ['ranking', 'swiping'],
      ['final_vote', 'ranking'],
      ['swiping', 'draft'],
    ];
    for (const [from, to] of illegal) for (const actor of ACTORS) {
      expect(canTransition(from, to, actor)).toBe(false);
    }
  });

  test('host or system can cancel any unfinished Pick', () => {
    for (const from of PICK_STATES.filter((s) => !isTerminal(s))) {
      expect(canTransition(from, 'canceled', 'host')).toBe(true);
      expect(canTransition(from, 'canceled', 'system')).toBe(true);
    }
  });

  test('completed and canceled are final', () => {
    for (const from of ['completed', 'canceled'] as const) {
      expect(isTerminal(from)).toBe(true);
      for (const to of PICK_STATES) for (const actor of ACTORS) {
        expect(canTransition(from, to, actor)).toBe(false);
      }
    }
  });
});
