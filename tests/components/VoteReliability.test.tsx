import React from 'react';
import VoteScreen from '../../app/pick/[id]/vote';
import { api } from '@/lib/api';
import { usePickLive } from '@/hooks/usePickLive';
const { create, act } = jest.requireActual('react-test-renderer');
jest.mock('react-native-reanimated', () => {
  const animation = {
    duration: () => animation,
    delay: () => animation,
    springify: () => animation,
  };
  return {
    __esModule: true,
    default: { View: jest.requireActual('react-native').View },
    FadeInDown: animation,
    FadeInUp: animation,
  };
});
jest.mock('@/components/ActivityToast', () => ({ ActivityToast: () => null }));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ id: 'pick' }) }));
jest.mock('@/hooks/useAuth', () => ({ useSession: () => ({ user: { id: 'me' } }) }));
jest.mock('@/hooks/usePickLive', () => ({ usePickLive: jest.fn() }));
jest.mock('@/hooks/usePickRoute', () => ({ usePickRoute: () => {} }));
jest.mock('@/hooks/useCountdown', () => ({ useCountdown: () => ({ label: null }) }));
jest.mock('@/hooks/usePullToRefresh', () => ({ usePullToRefresh: () => null }));
jest.mock('@/hooks/useProgressToasts', () => ({ useProgressToasts: () => ({ toast: null }) }));
jest.mock('@/hooks/useReveal', () => ({
  useReveal: () => ({
    reveal: {
      status: 'ready',
      myVote: null,
      ranking: [
        { placeId: 'a', rank: 1 },
        { placeId: 'b', rank: 2 },
      ],
      places: new Map([
        ['a', { name: 'First' }],
        ['b', { name: 'Second' }],
      ]),
    },
  }),
  finalistsOf: (ranking: unknown) => ranking,
}));
jest.mock('@/components/PickParts', () => ({
  pickStyles: {},
  PickTopBar: () => null,
  LiveDot: () => null,
}));
jest.mock('@/components/ResultCards', () => ({
  BigResult: (p: object) => jest.requireActual('react').createElement('test-result', p),
}));
jest.mock('@/components/Button', () => ({ Button: () => null }));
jest.mock('@/components/ErrorBanner', () => ({ ErrorBanner: () => null }));
jest.mock('@/lib/api', () => ({ api: { vote: jest.fn() } }));
jest.mock('@/lib/haptics', () => ({
  haptic: { tap: jest.fn(), success: jest.fn(), error: jest.fn() },
}));
let tree: any;
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  tree = null;
});
test('skipped second vote does not replace or roll back the active optimistic vote; rejection permits retry', async () => {
  const refresh = jest.fn();
  jest.mocked(usePickLive).mockReturnValue({ state: 'voting', refresh } as any);
  let reject!: (e: Error) => void;
  jest.mocked(api.vote).mockReturnValueOnce(
    new Promise((_yes, no) => {
      reject = no;
    }),
  );
  await act(async () => {
    tree = create(<VoteScreen />);
  });
  await act(async () => {
    const rows = tree.root.findAllByType('test-result');
    rows[0].props.onPress();
    rows[1].props.onPress();
  });
  expect(api.vote).toHaveBeenCalledTimes(1);
  expect(tree.root.findAllByType('test-result').map((n: any) => n.props.selected)).toEqual([
    true,
    false,
  ]);
  expect(refresh).not.toHaveBeenCalled();
  await act(async () => reject(new Error('Offline')));
  expect(tree.root.findAllByType('test-result').map((n: any) => n.props.selected)).toEqual([
    false,
    false,
  ]);
  jest.mocked(api.vote).mockResolvedValueOnce({ status: 'ok' } as any);
  await act(async () => tree.root.findAllByType('test-result')[1].props.onPress());
  expect(api.vote).toHaveBeenCalledTimes(2);
  expect(refresh).toHaveBeenCalledTimes(2);
  expect(tree.root.findAllByType('test-result').map((n: any) => n.props.selected)).toEqual([
    false,
    true,
  ]);
});
