import React from 'react';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import WaitingScreen from '../../app/pick/[id]/waiting';
import { usePickLive } from '@/hooks/usePickLive';

const { create, act } = jest.requireActual('react-test-renderer');
jest.mock('expo-notifications', () => ({
  scheduleNotificationAsync: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ granted: true })),
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
}));
jest.mock('expo-router', () => ({
  router: { replace: jest.fn() },
  useLocalSearchParams: () => ({ id: 'pick' }),
}));
jest.mock('@/hooks/usePickLive', () => ({ usePickLive: jest.fn() }));
jest.mock('@/hooks/usePickRoute', () => ({ usePickRoute: jest.fn() }));
jest.mock('@/hooks/usePullToRefresh', () => ({ usePullToRefresh: () => undefined }));
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => true }));
jest.mock('@/components/PickParts', () => ({
  pickStyles: {},
  FlameOrb: () => null,
  GroupAvatars: () => null,
  LiveDot: () => null,
  PickTopBar: () => null,
}));
jest.mock('@/components/Button', () => ({ Button: () => null }));

test.each(['final_vote', 'completed', 'canceled'] as const)(
  'a backgrounded waiting screen does not schedule another OS alert on %s',
  async (state) => {
    const previous = AppState.currentState;
    AppState.currentState = 'background';
    jest.mocked(Notifications.scheduleNotificationAsync).mockClear();
    const live = {
      progress: null,
      deadline: null,
      mode: 'realtime' as const,
      error: null,
      refresh: jest.fn(async () => {}),
    };
    jest.mocked(usePickLive).mockReturnValue({ ...live, state: 'swiping' });
    let tree!: ReturnType<typeof create>;
    try {
      await act(async () => {
        tree = create(<WaitingScreen />);
      });
      jest.mocked(usePickLive).mockReturnValue({ ...live, state });
      await act(async () => tree.update(<WaitingScreen />));
      expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    } finally {
      await act(async () => tree?.unmount());
      AppState.currentState = previous;
    }
  },
);
