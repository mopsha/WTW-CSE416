import React from 'react';
import HangScreen from '../../app/hang/[id]';
import { api } from '@/lib/api';
import type { HangPost } from '@shared/api/hang.ts';

const { act, create } = jest.requireActual('react-test-renderer');
const id = '54000000-0000-4000-8000-000000000099';
let mockUserId = 'viewer';
let mockRefresh: () => Promise<void>;
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id }),
  router: { push: jest.fn() },
}));
jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ session: { user: { id: mockUserId } } }),
}));
jest.mock('@/hooks/usePrivateRefresh', () => ({
  usePrivateRefresh(load: () => Promise<void>, clear: () => void) {
    jest.requireActual('react').useEffect(() => {
      mockRefresh = load;
      void load();
      return clear;
    }, [load, clear]);
  },
}));
jest.mock('@/lib/api', () => ({
  api: { getHangPost: jest.fn(), getHang: jest.fn(), respondHang: jest.fn() },
}));
jest.mock('@/components/picks/HangInvitation', () => ({
  HangInvitation: (props: object) => jest.requireActual('react').createElement('hang-card', props),
}));
jest.mock('@/components', () => ({
  ...jest.requireActual('@/components/theme'),
  Screen: ({ children }: { children: React.ReactNode }) => children,
  ErrorState: (props: object) => jest.requireActual('react').createElement('hang-error', props),
}));

let tree: ReturnType<typeof create>;
const card = () => tree.root.findByType('hang-card');
const banner = () => tree.root.findByType('hang-error');

function makePost(): HangPost {
  return {
    id,
    authorId: 'someone',
    activity: 'A Hang outside the feed page',
    audience: 'selected',
    groupId: null,
    startsAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  };
}

function failure(status: number, message = 'Private details') {
  return Object.assign(new Error(message), { status });
}

async function mount(post = makePost()) {
  jest.mocked(api.getHangPost).mockResolvedValue(post);
  await act(async () => {
    tree = create(<HangScreen />);
  });
  return post;
}

beforeEach(() => {
  jest.resetAllMocks();
  mockUserId = 'viewer';
});

afterEach(async () => {
  await act(async () => tree?.unmount());
  jest.useRealTimers();
});

test('opens a Hang directly even if it is beyond the feed page', async () => {
  const post = await mount();
  expect(api.getHangPost).toHaveBeenCalledWith(id, 'viewer');
  expect(api.getHang).not.toHaveBeenCalled();
  expect(card().props.post).toEqual(post);
});

test.each([0, 408, 503])(
  'keeps the card on a transient refresh failure (%s) and retries',
  async (status) => {
    const post = await mount();
    jest.mocked(api.getHangPost).mockRejectedValueOnce(failure(status, 'Could not refresh'));
    await act(mockRefresh);
    expect(card().props.post).toEqual(post);
    expect(banner().props.message).toBe('Could not refresh');

    const refreshed = { ...post, downCount: 4 };
    jest.mocked(api.getHangPost).mockResolvedValueOnce(refreshed);
    await act(async () => banner().props.onRetry());
    expect(card().props.post).toEqual(refreshed);
    expect(tree.root.findAllByType('hang-error')).toHaveLength(0);
  },
);

test.each([401, 403, 404, 410])('revokes an already loaded card on status %s', async (status) => {
  await mount();
  jest.mocked(api.getHangPost).mockRejectedValueOnce(failure(status));
  await act(mockRefresh);
  expect(tree.root.findAllByType('hang-card')).toHaveLength(0);
  expect(banner().props).toMatchObject({
    message: 'This Hang is no longer available to you.',
    onRetry: undefined,
  });
});

test('clears an expired card even while refresh is unavailable', async () => {
  jest.useFakeTimers();
  await mount({ ...makePost(), expiresAt: new Date(Date.now() + 1000).toISOString() });
  jest.mocked(api.getHangPost).mockRejectedValueOnce(failure(0));
  await act(mockRefresh);
  expect(card()).toBeDefined();
  await act(async () => jest.advanceTimersByTime(1000));
  expect(tree.root.findAllByType('hang-card')).toHaveLength(0);
  expect(banner().props.onRetry).toBeUndefined();
});

test('retains a queued optimistic RSVP through a failed refresh and confirms it', async () => {
  const post = await mount();
  let finish!: () => void;
  jest.mocked(api.respondHang).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = () => resolve({ status: 'ok' });
      }),
  );
  jest.mocked(api.respondHang).mockResolvedValueOnce({ status: 'ok' });
  await act(async () => card().props.onRespond('down'));
  await act(async () => card().props.onRespond('maybe'));
  expect(card().props.pending).toBe(true);

  jest.mocked(api.getHangPost).mockRejectedValueOnce(failure(503));
  await act(mockRefresh);
  expect(card().props.pending).toBe(true);
  expect(card().props.post.myStatus).toBe('maybe');

  jest
    .mocked(api.getHangPost)
    .mockResolvedValueOnce({ ...post, myStatus: 'down', downCount: 1 })
    .mockResolvedValueOnce({ ...post, myStatus: 'maybe', maybeCount: 1 });
  await act(async () => finish());
  expect(api.respondHang).toHaveBeenLastCalledWith(id, 'maybe', 'viewer');
  expect(card().props.pending).toBe(false);
  expect(card().props.post.myStatus).toBe('maybe');
});

test('account changes discard the previous card and any late refresh result', async () => {
  const post = await mount();
  let finish!: (value: HangPost) => void;
  jest.mocked(api.getHangPost).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  let pending!: Promise<void>;
  await act(async () => {
    pending = mockRefresh();
  });

  mockUserId = 'different-account';
  jest.mocked(api.getHangPost).mockRejectedValueOnce(failure(404));
  await act(async () => tree.update(<HangScreen />));
  await act(async () => {
    finish(post);
    await pending;
  });
  expect(api.getHangPost).toHaveBeenLastCalledWith(id, 'different-account');
  expect(tree.root.findAllByType('hang-card')).toHaveLength(0);
  expect(banner().props.message).toBe('This Hang is no longer available to you.');
});
