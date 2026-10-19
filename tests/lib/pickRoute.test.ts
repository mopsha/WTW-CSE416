import { pathFor, redirectFor, screenForState } from '@/lib/pickRoute';
import type { PickState } from '@/lib/types';

describe('screenForState: where a fresh arrival lands', () => {
  test.each<[PickState, boolean, string]>([
    ['draft', false, 'lobby'],
    ['swiping', false, 'swipe'],
    ['swiping', true, 'waiting'],
    ['ranking', false, 'results'],
    // Late arrival during the vote goes straight to the ballot.
    ['final_vote', false, 'vote'],
    ['completed', false, 'winner'],
    ['canceled', false, 'index'],
  ])('%s (all answered: %s) -> %s', (state, allAnswered, screen) => {
    expect(screenForState(state, { allAnswered })).toBe(screen);
  });
});

describe('redirectFor: screens follow the Pick state', () => {
  test('a screen that fits the state stays', () => {
    expect(redirectFor('lobby', 'draft')).toBeNull();
    expect(redirectFor('swipe', 'swiping')).toBeNull();
    expect(redirectFor('waiting', 'swiping', { allAnswered: true })).toBeNull();
    expect(redirectFor('results', 'final_vote')).toBeNull();
    expect(redirectFor('vote', 'final_vote')).toBeNull();
    expect(redirectFor('results', 'completed')).toBeNull();
  });

  test('the host starting moves the lobby to the deck', () => {
    expect(redirectFor('lobby', 'swiping', { from: 'draft' })).toBe('swipe');
  });

  test('closing moves swipers and waiters to the reveal, not past it', () => {
    expect(redirectFor('waiting', 'completed', { from: 'swiping' })).toBe('results');
    expect(redirectFor('waiting', 'final_vote', { from: 'swiping' })).toBe('results');
    expect(redirectFor('swipe', 'final_vote', { from: 'swiping' })).toBe('results');
    expect(redirectFor('waiting', 'ranking', { from: 'swiping' })).toBe('results');
  });

  test('opening an already-closed Pick skips the reveal', () => {
    expect(redirectFor('swipe', 'final_vote', { from: null })).toBe('vote');
    expect(redirectFor('swipe', 'completed', { from: null })).toBe('winner');
  });

  test('the vote settling moves voters to the winner', () => {
    expect(redirectFor('vote', 'completed', { from: 'final_vote' })).toBe('winner');
  });

  test('cancel sends every screen to the canceled view', () => {
    for (const screen of ['lobby', 'swipe', 'waiting', 'vote'] as const) {
      expect(redirectFor(screen, 'canceled')).toBe('index');
    }
  });
});

test('pathFor builds typed routes', () => {
  expect(pathFor('index')).toBe('/pick/[id]');
  expect(pathFor('vote')).toBe('/pick/[id]/vote');
});
