import React from 'react';
import HistoryScreen from '../../app/history';
import { api } from '@/lib/api';
import type { PastMove } from '@shared/api/pastMoves.ts';
type Tree = {
  root: {
    findAllByType(t: string): { props: { message?: string; accessibilityLabel?: string } }[];
  };
  toJSON(): unknown;
  unmount(): void;
};
const { create, act } = jest.requireActual<{
  create(e: React.ReactElement): Tree;
  act(work: () => void | Promise<void>): Promise<void>;
}>('react-test-renderer');
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useLocalSearchParams: () => ({}),
  useFocusEffect: (effect: () => void) => jest.requireActual('react').useEffect(effect, [effect]),
}));
jest.mock('@/lib/api', () => ({ api: { getHistory: jest.fn(), getMyPastMoves: jest.fn() } }));
jest.mock('@/components', () => {
  const React = jest.requireActual('react');
  return {
    ...jest.requireActual('@/components/theme'),
    Screen: ({ children }: { children: React.ReactNode }) => children,
    Card: (p: { children: React.ReactNode }) => React.createElement('test-card', p, p.children),
    ErrorState: (p: object) => React.createElement('test-error', p),
    EmptyState: () => null,
  };
});
beforeEach(() =>
  jest
    .mocked(api.getHistory)
    .mockResolvedValue({
      picks: [
        {
          id: 'pick-1',
          category: 'food',
          decidedAt: '2026-11-01T12:00:00Z',
          decidedBy: 'clear_winner',
          planAt: null,
          groupId: null,
          winner: { placeId: 'place-1', name: 'Frozen dinner' },
          finalists: [],
          participants: [],
          wentCount: 1,
        },
      ],
    }),
);
test('attendance enhances the existing History item without duplicating a plan', async () => {
  jest
    .mocked(api.getMyPastMoves)
    .mockResolvedValue({
      visible: true,
      pastMoves: [{ pickId: 'pick-1', occurredAt: '2026-11-01T12:00:00Z' } as PastMove],
    });
  let tree!: Tree;
  await act(async () => {
    tree = create(<HistoryScreen />);
  });
  expect(tree.root.findAllByType('test-card')).toHaveLength(1);
  expect(tree.root.findAllByType('test-card')[0]!.props.accessibilityLabel).toContain('Past Move');
  await act(async () => tree.unmount());
});
test('a missing Past Moves API never breaks the existing History list', async () => {
  jest.mocked(api.getMyPastMoves).mockRejectedValue(new Error('Not installed'));
  let tree!: Tree;
  await act(async () => {
    tree = create(<HistoryScreen />);
  });
  expect(tree.root.findAllByType('test-card')).toHaveLength(1);
  expect(JSON.stringify(tree.toJSON())).toContain('Frozen dinner');
  expect(tree.root.findAllByType('test-error')[0]!.props.message).toContain('Not installed');
  await act(async () => tree.unmount());
});
