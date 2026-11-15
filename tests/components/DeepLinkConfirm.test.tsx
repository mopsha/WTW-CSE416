import React from 'react';
import JoinByLink from '../../app/join/[code]';
import InviteLink from '../../app/i/[token]';
import { api } from '@/lib/api';
const { create, act } = jest.requireActual('react-test-renderer');

const mockJoin = jest.fn(async () => 'pick-1');
jest.mock('expo-router', () => ({
  router: { replace: jest.fn() },
  useLocalSearchParams: () => ({ code: 'ABC123', token: 'tok' }),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ session: { user: { id: 'me' } } }) }));
jest.mock('@/hooks/useJoinPick', () => ({ useJoinPick: () => ({ error: null, join: mockJoin }) }));
jest.mock('@/lib/api', () => ({
  api: { acceptInvite: jest.fn(async () => ({ kind: 'pick', targetId: 'pick-2' })) },
}));
jest.mock('@/lib/haptics', () => ({ haptic: { success: jest.fn(), error: jest.fn() } }));
jest.mock('@/lib/pendingJoin', () => ({ setPendingJoin: jest.fn() }));
jest.mock('@/lib/pendingInvite', () => ({ setPendingInvite: jest.fn(async () => {}) }));
jest.mock('@shared/domain/inviteLink.ts', () => ({ parseInviteToken: (t: string) => t }));
jest.mock('@/components/PickParts', () => {
  const R = jest.requireActual('react');
  return {
    CenterMessage: ({ children }: { children: React.ReactNode }) =>
      R.createElement('msg', null, children),
    FlameOrb: () => null,
    goToPicks: jest.fn(),
    pickStyles: {},
  };
});
jest.mock('@/components/Button', () => ({
  Button: (p: object) => jest.requireActual('react').createElement('btn', p),
}));
jest.mock('@/components/GradientButton', () => ({
  GradientButton: (p: object) => jest.requireActual('react').createElement('primary', p),
}));

beforeEach(() => jest.clearAllMocks());

test('a join link asks before joining', async () => {
  let tree: any;
  await act(async () => {
    tree = create(<JoinByLink />);
  });
  expect(mockJoin).not.toHaveBeenCalled();
  await act(async () => tree.root.findByType('primary').props.onPress());
  expect(mockJoin).toHaveBeenCalledWith('ABC123');
  await act(async () => tree.unmount());
});

test('an invite link asks before accepting', async () => {
  let tree: any;
  await act(async () => {
    tree = create(<InviteLink />);
  });
  expect(api.acceptInvite).not.toHaveBeenCalled();
  await act(async () => tree.root.findByType('primary').props.onPress());
  expect(api.acceptInvite).toHaveBeenCalledWith('tok');
  await act(async () => tree.unmount());
});
