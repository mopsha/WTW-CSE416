import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useAction } from '@/hooks/useAction';
import { useCountdown } from '@/hooks/useCountdown';
import { haptic } from '@/lib/haptics';
const { create, act } = jest.requireActual('react-test-renderer');
jest.mock('@/lib/haptics', () => ({ haptic: { error: jest.fn() } }));
let action!: ReturnType<typeof useAction>;
let countdown!: ReturnType<typeof useCountdown>;
function Actions() {
  const value = useAction();
  React.useEffect(() => {
    action = value;
  }, [value]);
  return null;
}
function Timer({ deadline }: { deadline: string | null }) {
  const value = useCountdown(deadline);
  React.useEffect(() => {
    countdown = value;
  }, [value]);
  return null;
}
function deferred() {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
let tree: any;
beforeEach(() => {
  jest.clearAllMocks();
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  tree = null;
  jest.restoreAllMocks();
  jest.useRealTimers();
});
test('same-tick calls are skipped distinctly; failure releases the lock for a successful retry', async () => {
  await act(async () => {
    tree = create(<Actions />);
  });
  const pending = deferred();
  const fn = jest.fn(() => pending.promise);
  let first!: Promise<boolean | null>;
  await act(async () => {
    first = action.run('save', fn);
    expect(await action.run('save', fn)).toBeNull();
    expect(await action.run('other', fn)).toBeNull();
  });
  expect(fn).toHaveBeenCalledTimes(1);
  expect(action.busy).toBe('save');
  await act(async () => {
    pending.reject(new Error('Offline'));
    expect(await first).toBe(false);
  });
  expect(action.busy).toBeNull();
  expect(action.error).toBe('Offline');
  await act(async () => {
    expect(await action.run('save', async () => {})).toBe(true);
  });
  expect(action.error).toBeNull();
  expect(haptic.error).toHaveBeenCalledTimes(1);
});
test.each(['resolve', 'reject'] as const)(
  'unmount before %s suppresses success, errors and further calls',
  async (settle) => {
    await act(async () => {
      tree = create(<Actions />);
    });
    const pending = deferred();
    let running!: Promise<boolean | null>;
    await act(async () => {
      running = action.run('save', () => pending.promise);
    });
    await act(async () => tree.unmount());
    tree = null;
    await act(async () => {
      if (settle === 'resolve') pending.resolve();
      else pending.reject(new Error('Late failure'));
      expect(await running).toBeNull();
    });
    expect(haptic.error).not.toHaveBeenCalled();
    const fn = jest.fn();
    expect(await action.run('save', fn)).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  },
);
test('separate hook instances allow independent actions to run concurrently', async () => {
  let other!: ReturnType<typeof useAction>;
  function Independent() {
    const value = useAction();
    React.useEffect(() => {
      other = value;
    }, [value]);
    return <Actions />;
  }
  await act(async () => {
    tree = create(<Independent />);
  });
  const pending = deferred();
  let first!: Promise<boolean | null>;
  await act(async () => {
    first = action.run('one', () => pending.promise);
    expect(await other.run('two', async () => {})).toBe(true);
  });
  await act(async () => {
    pending.resolve();
    expect(await first).toBe(true);
  });
});
function setupClock() {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-11-14T12:00:00Z'));
  AppState.currentState = 'active';
  let state!: (s: AppStateStatus) => void;
  const remove = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    state = listener;
    return { remove };
  });
  return {
    state: (s: AppStateStatus) => {
      AppState.currentState = s;
      state(s);
    },
    remove,
  };
}
test('countdown stops at expiry; changed deadlines restart and null removes the timer', async () => {
  const { remove } = setupClock();
  const deadline = new Date(Date.now() + 2000).toISOString();
  await act(async () => {
    tree = create(<Timer deadline={deadline} />);
  });
  expect(countdown).toEqual({ label: '0:02 left', passed: false });
  await act(async () => jest.advanceTimersByTime(2000));
  expect(countdown.passed).toBe(true);
  jest.runAllTicks();
  expect(jest.getTimerCount()).toBe(0);
  await act(async () =>
    tree.update(<Timer deadline={new Date(Date.now() + 3000).toISOString()} />),
  );
  expect(countdown).toEqual({ label: '0:03 left', passed: false });
  jest.runAllTicks();
  expect(jest.getTimerCount()).toBe(1);
  await act(async () => tree.update(<Timer deadline={null} />));
  expect(countdown).toEqual({ label: null, passed: false });
  jest.runAllTicks();
  expect(jest.getTimerCount()).toBe(0);
  expect(remove).toHaveBeenCalled();
});
test('background pauses work, foreground resamples wall clock and can restart after clock correction', async () => {
  const { state } = setupClock();
  const start = Date.now();
  const deadline = new Date(start + 5000).toISOString();
  await act(async () => {
    tree = create(<Timer deadline={deadline} />);
  });
  await act(async () => state('background'));
  jest.runAllTicks();
  expect(jest.getTimerCount()).toBe(0);
  jest.setSystemTime(start + 10000);
  await act(async () => state('active'));
  expect(countdown.passed).toBe(true);
  jest.runAllTicks();
  expect(jest.getTimerCount()).toBe(0);
  await act(async () => state('inactive'));
  jest.setSystemTime(start);
  await act(async () => state('active'));
  expect(countdown.passed).toBe(false);
  jest.runAllTicks();
  expect(jest.getTimerCount()).toBe(1);
  jest.setSystemTime(start + 20000);
  await act(async () => jest.advanceTimersByTime(1000));
  expect(countdown.passed).toBe(true);
  jest.runAllTicks();
  expect(jest.getTimerCount()).toBe(0);
});

test('synchronous action errors also release the lock', async () => {
  await act(async () => {
    tree = create(<Actions />);
  });
  await act(async () => {
    expect(
      await action.run('save', () => {
        throw new Error('Invalid');
      }),
    ).toBe(false);
  });
  await act(async () => {
    expect(await action.run('retry', async () => {})).toBe(true);
  });
});

test('active countdown follows backwards clock changes and unmount clears its interval', async () => {
  setupClock();
  const start = Date.now();
  await act(async () => {
    tree = create(<Timer deadline={new Date(start + 5000).toISOString()} />);
  });
  jest.setSystemTime(start - 5000);
  await act(async () => jest.advanceTimersByTime(1000));
  expect(countdown).toEqual({ label: '0:09 left', passed: false });
  await act(async () => tree.unmount());
  tree = null;
  jest.runAllTicks();
  expect(jest.getTimerCount()).toBe(0);
});
