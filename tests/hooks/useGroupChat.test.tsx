import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useGroupChat, GROUP_CHAT_POLL_MS } from '@/hooks/useGroupChat';
import { api } from '@/lib/api';
import type { LiveSource, LiveStatus } from '@/lib/live';
const { create, act } = jest.requireActual<{
  create(element: React.ReactElement): { unmount(): void };
  act(work: () => void | Promise<void>): Promise<void>;
}>('react-test-renderer');
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void) => jest.requireActual('react').useEffect(effect, [effect]),
}));
jest.mock('@/lib/api', () => ({ api: { listGroupMessages: jest.fn() } }));
jest.mock('@/lib/groupChatLive', () => ({ groupChatLive: { subscribe: jest.fn() } }));
const message = {
  id: 'message-1',
  groupId: 'group-1',
  senderId: 'friend',
  senderName: 'Friend',
  senderUsername: null,
  senderAvatarUrl: null,
  body: 'Hi',
  createdAt: '2026-11-02T12:00:00Z',
};
let result!: ReturnType<typeof useGroupChat>;
let change!: () => void;
let status!: (s: LiveStatus) => void;
let state!: (s: AppStateStatus) => void;
const unsubscribe = jest.fn();
const remove = jest.fn();
const source: LiveSource = {
  subscribe: (_id, onChange, onStatus) => {
    change = onChange;
    status = onStatus;
    return unsubscribe;
  },
};
function Harness() {
  const value = useGroupChat('group-1', source);
  React.useEffect(() => {
    result = value;
  }, [value]);
  return null;
}
let tree: { unmount(): void };
beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  AppState.currentState = 'active';
  jest.mocked(api.listGroupMessages).mockResolvedValue({ messages: [message] });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    state = listener;
    return { remove };
  });
  await act(async () => {
    tree = create(<Harness />);
  });
});
afterEach(async () => {
  await act(async () => tree.unmount());
  expect(unsubscribe).toHaveBeenCalled();
  expect(remove).toHaveBeenCalled();
  jest.restoreAllMocks();
  jest.useRealTimers();
});
test('Realtime invalidates history; polling also checks revocation', async () => {
  expect(result.messages).toEqual([message]);
  await act(async () => {
    status('live');
  });
  expect(result.mode).toBe('realtime');
  jest.mocked(api.listGroupMessages).mockResolvedValue({ messages: [{ ...message, body: 'New' }] });
  await act(async () => change());
  expect(result.messages[0]!.body).toBe('New');
  jest
    .mocked(api.listGroupMessages)
    .mockRejectedValue(Object.assign(new Error('Group not found'), { status: 404 }));
  await act(async () => {
    jest.advanceTimersByTime(GROUP_CHAT_POLL_MS);
  });
  expect(result.messages).toEqual([]);
  expect(result.unavailable).toBe(true);
});
test('background suspends fetches and clears content; foreground revalidates; channel timeout uses polling', async () => {
  await act(async () => state('background'));
  const count = jest.mocked(api.listGroupMessages).mock.calls.length;
  expect(result.messages).toEqual([]);
  await act(async () => {
    jest.advanceTimersByTime(10000);
  });
  expect(api.listGroupMessages).toHaveBeenCalledTimes(count);
  expect(result.mode).toBe('polling');
  await act(async () => state('active'));
  expect(result.messages).toEqual([message]);
});
test('offline errors clear cached chat and a later poll recovers', async () => {
  jest.mocked(api.listGroupMessages).mockRejectedValue(new Error('Offline'));
  await act(async () => change());
  expect(result.messages).toEqual([]);
  expect(result.error).toBe('Offline');
  jest.mocked(api.listGroupMessages).mockResolvedValue({ messages: [message] });
  await act(async () => {
    jest.advanceTimersByTime(GROUP_CHAT_POLL_MS);
  });
  expect(result.messages).toEqual([message]);
  expect(result.error).toBeNull();
});

test('an error from an obsolete foreground request cannot revoke a newly queued refresh', async () => {
  let reject!: (error: Error) => void;
  jest.mocked(api.listGroupMessages).mockReturnValueOnce(
    new Promise((_resolve, r) => {
      reject = r;
    }),
  );
  await act(async () => change());
  await act(async () => state('background'));
  jest
    .mocked(api.listGroupMessages)
    .mockResolvedValue({ messages: [{ ...message, body: 'Revalidated' }] });
  await act(async () => state('active'));
  await act(async () => reject(Object.assign(new Error('Old denied response'), { status: 404 })));
  expect(result.messages[0]!.body).toBe('Revalidated');
  expect(result.unavailable).toBe(false);
  expect(result.error).toBeNull();
});

test('manual refresh awaits its queued read behind an in-flight poll', async () => {
  let pollDone!: (value: { messages: (typeof message)[] }) => void;
  let manualDone!: (value: { messages: (typeof message)[] }) => void;
  jest
    .mocked(api.listGroupMessages)
    .mockReturnValueOnce(
      new Promise((resolve) => {
        pollDone = resolve;
      }),
    )
    .mockReturnValueOnce(
      new Promise((resolve) => {
        manualDone = resolve;
      }),
    );
  await act(async () => change());
  let settled = false;
  let refresh!: Promise<void>;
  await act(async () => {
    refresh = result.refresh().then(() => {
      settled = true;
    });
  });
  expect(settled).toBe(false);
  await act(async () => pollDone({ messages: [message] }));
  expect(settled).toBe(false);
  await act(async () => manualDone({ messages: [{ ...message, body: 'Manual result' }] }));
  await refresh;
  expect(settled).toBe(true);
  expect(result.messages[0]!.body).toBe('Manual result');
});

test('background cancellation settles a direct manual refresh and rejects its stale data', async () => {
  let finish!: (value: { messages: (typeof message)[] }) => void;
  jest.mocked(api.listGroupMessages).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  let settled = false;
  await act(async () => {
    void result.refresh().then(() => {
      settled = true;
    });
  });
  expect(settled).toBe(false);
  await act(async () => state('background'));
  expect(settled).toBe(true);
  await act(async () => finish({ messages: [message] }));
  expect(result.messages).toEqual([]);
});
