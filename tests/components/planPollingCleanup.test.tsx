import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { PlanBlock } from '@/components/PlanBlock';
import { api } from '@/lib/api';
const { create, act } = jest.requireActual<{
  create(e: React.ReactElement): { unmount(): void };
  act(work: () => void | Promise<void>): Promise<void>;
}>('react-test-renderer');
jest.mock('expo-router', () => ({
  router: { replace: jest.fn() },
  useFocusEffect: (effect: () => void) => jest.requireActual('react').useEffect(effect, [effect]),
}));
jest.mock('@/lib/api', () => ({ api: { getPlan: jest.fn() } }));
jest.mock('@/components/Chips', () => ({ Chips: () => null }));
jest.mock('@/components/Button', () => ({ Button: () => null }));
jest.mock('@/components/PickParts', () => ({ pickStyles: { card: {}, section: {} } }));
test('plan polling retains its 30-second cadence and stops in background/after leaving', async () => {
  jest.useFakeTimers();
  AppState.currentState = 'active';
  let state!: (s: AppStateStatus) => void;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_name, listener) => {
    state = listener;
    return { remove: jest.fn() };
  });
  jest
    .mocked(api.getPlan)
    .mockResolvedValue({
      state: 'completed',
      isHost: false,
      planAt: null,
      participantCount: 1,
      rsvps: { going: 0, maybe: 0, notGoing: 0 },
      myRsvp: null,
      outcomes: { went: 0, didNotGo: 0, again: 0 },
      myOutcome: null,
    });
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(<PlanBlock pickId="pick" decidedAt={null} />);
  });
  expect(api.getPlan).toHaveBeenCalledTimes(1);
  await act(async () => {
    jest.advanceTimersByTime(5000);
  });
  expect(api.getPlan).toHaveBeenCalledTimes(1);
  await act(async () => {
    jest.advanceTimersByTime(25000);
  });
  expect(api.getPlan).toHaveBeenCalledTimes(2);
  await act(async () => state('background'));
  await act(async () => {
    jest.advanceTimersByTime(60000);
  });
  expect(api.getPlan).toHaveBeenCalledTimes(2);
  await act(async () => state('active'));
  expect(api.getPlan).toHaveBeenCalledTimes(3);
  await act(async () => tree.unmount());
  await act(async () => {
    jest.advanceTimersByTime(30000);
  });
  expect(api.getPlan).toHaveBeenCalledTimes(3);
  jest.restoreAllMocks();
  jest.clearAllTimers();
  jest.useRealTimers();
});
