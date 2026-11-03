import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { usePrivateRefresh, PRIVATE_REFRESH_MS } from '@/hooks/usePrivateRefresh';
const { create, act } = jest.requireActual<{
  create(e: React.ReactElement): { unmount(): void };
  act(work: () => void | Promise<void>): Promise<void>;
}>('react-test-renderer');
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void) => jest.requireActual('react').useEffect(effect, [effect]),
}));
test('private refresh coalesces reads, clears on background/blur, revalidates foreground and removes listeners', async () => {
  jest.useFakeTimers();
  AppState.currentState = 'active';
  const interval = jest.spyOn(globalThis, 'setInterval');
  const clearIntervalSpy = jest.spyOn(globalThis, 'clearInterval');
  let listener!: (s: AppStateStatus) => void;
  const remove = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_name, l) => {
    listener = l;
    return { remove };
  });
  let release!: () => void;
  const refresh = jest
    .fn()
    .mockReturnValueOnce(
      new Promise<void>((r) => {
        release = r;
      }),
    )
    .mockResolvedValue(undefined);
  const clear = jest.fn();
  function Harness() {
    usePrivateRefresh(refresh, clear);
    return null;
  }
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(<Harness />);
  });
  await act(async () => {
    jest.advanceTimersByTime(PRIVATE_REFRESH_MS * 2);
  });
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(async () => listener('background'));
  expect(clear).toHaveBeenCalledTimes(1);
  await act(async () => release());
  await act(async () => {
    jest.advanceTimersByTime(PRIVATE_REFRESH_MS);
  });
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(async () => listener('active'));
  expect(refresh).toHaveBeenCalledTimes(2);
  await act(async () => tree.unmount());
  expect(clear).toHaveBeenCalledTimes(2);
  expect(remove).toHaveBeenCalledTimes(1);
  expect(clearIntervalSpy).toHaveBeenCalledWith(interval.mock.results[0]!.value);
  jest.clearAllTimers();
  jest.restoreAllMocks();
  jest.useRealTimers();
});
