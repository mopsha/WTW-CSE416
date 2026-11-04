import React from 'react';
import { PastMoves } from '@/components/PastMoves';
import { api } from '@/lib/api';
import type { PastMove } from '@shared/api/pastMoves.ts';
type Tree = {
  root: { findAllByType(t: string): { props: { onPress(): void; accessibilityLabel?: string } }[] };
  toJSON(): unknown;
  unmount(): void;
};
const { create, act } = jest.requireActual<{
  create(e: React.ReactElement): Tree;
  act(work: () => void | Promise<void>): Promise<void>;
}>('react-test-renderer');
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useFocusEffect: (effect: () => void) => jest.requireActual('react').useEffect(effect, [effect]),
}));
jest.mock('@/lib/api', () => ({ api: { getUserPastMoves: jest.fn() } }));
jest.mock('@/components', () => {
  const React = jest.requireActual('react');
  return {
    ...jest.requireActual('@/components/theme'),
    Card: (p: { children: React.ReactNode }) => React.createElement('test-card', p, p.children),
    Button: (p: object) => React.createElement('test-button', p),
    ErrorState: (p: object) => React.createElement('test-error', p),
  };
});
const move: PastMove = {
  pickId: 'pick-1',
  category: 'activities',
  occurredAt: '2026-11-01T12:00:00Z',
  confirmedAt: '2026-11-01T14:00:00Z',
  winner: {
    placeId: 'custom:1',
    name: 'Catan at John’s',
    locationText: 'Original home',
    origin: 'group_idea',
  },
  group: null,
  participantCount: null,
  attendedCount: null,
};
test.each(['default', 'profile'] as const)(
  'hidden profiles render no memory content or cards (%s)',
  async (variant) => {
    jest.mocked(api.getUserPastMoves).mockResolvedValue({ visible: false, pastMoves: [] });
    let tree!: Tree;
    await act(async () => {
      tree = create(<PastMoves userId="friend" variant={variant} />);
    });
    expect(tree.root.findAllByType('test-card')).toHaveLength(0);
    expect(JSON.stringify(tree.toJSON())).toContain('Past Moves are private');
    await act(async () => tree.unmount());
  },
);
test.each(['default', 'profile'] as const)(
  'frozen memories render without photos or participant data and expand within the bounded list (%s)',
  async (variant) => {
    jest.mocked(api.getUserPastMoves).mockResolvedValue({
      visible: true,
      pastMoves: Array.from({ length: 6 }, (_, i) => ({ ...move, pickId: `pick-${i}` })),
    });
    let tree!: Tree;
    await act(async () => {
      tree = create(<PastMoves userId="friend" variant={variant} />);
    });
    expect(tree.root.findAllByType('test-card')).toHaveLength(5);
    expect(JSON.stringify(tree.toJSON())).toContain('Catan at John’s');
    expect(JSON.stringify(tree.toJSON())).not.toContain('participants');
    await act(async () => tree.root.findAllByType('test-button')[0]!.props.onPress());
    expect(tree.root.findAllByType('test-card')).toHaveLength(6);
    await act(async () => tree.unmount());
  },
);

test.each(['default', 'profile'] as const)(
  'focused privacy revocation removes already rendered memory content (%s)',
  async (variant) => {
    jest.useFakeTimers();
    jest.mocked(api.getUserPastMoves).mockResolvedValue({ visible: true, pastMoves: [move] });
    let tree!: Tree;
    await act(async () => {
      tree = create(<PastMoves userId="friend" variant={variant} />);
    });
    expect(tree.root.findAllByType('test-card')).toHaveLength(1);
    jest.mocked(api.getUserPastMoves).mockResolvedValue({ visible: false, pastMoves: [] });
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(tree.root.findAllByType('test-card')).toHaveLength(0);
    await act(async () => tree.unmount());
    jest.clearAllTimers();
    jest.useRealTimers();
  },
);
