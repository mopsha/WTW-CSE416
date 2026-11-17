import { notificationText } from '@shared/api/notify.ts';
import { rsvp } from '@shared/api/plans.ts';
import {
  actOnTimeSuggestion,
  suggestTime,
  type TimeSuggestionsStore,
} from '@shared/api/timeSuggestions.ts';
import { createApiClient, type FetchLike } from '@/lib/api';
const id = 'a3000000-0000-4000-8000-000000000001';
const future = () => new Date(Date.now() + 2 * 86400000).toISOString();
function fixture() {
  return {
    load: jest.fn(),
    suggest: jest.fn().mockResolvedValue({ id, notifyUserIds: ['host'] }),
    act: jest.fn().mockResolvedValue({ id, notifyUserIds: ['friend'] }),
    notifier: jest.fn().mockResolvedValue(undefined),
  } satisfies TimeSuggestionsStore;
}
test('validated zoned instant and actor go to the store; only proposal ID is exposed', async () => {
  const store = fixture(),
    planAt = future();
  expect(await suggestTime(store, 'pick', 'actor', { planAt, revision: 1 })).toEqual({ id });
  expect(store.suggest).toHaveBeenCalledWith('pick', 'actor', 1, planAt);
  expect(store.notifier).toHaveBeenCalledWith(['host'], 'time_suggested', 'pick', {
    timeSuggestionId: id,
  });
});
test.each([
  { revision: -1 },
  { revision: 0.5 },
  { revision: '1' },
  { revision: 1, userId: 'spoof' },
  { revision: 1, planAt: '2028-01-01' },
  { revision: 1, planAt: '2000-01-01T00:00:00Z' },
])('invalid suggestion %p never writes', async (bad) => {
  const store = fixture();
  await expect(
    suggestTime(store, 'pick', 'actor', { planAt: future(), ...bad }),
  ).rejects.toMatchObject({ status: 400 });
  expect(store.suggest).not.toHaveBeenCalled();
});
test.each(['accept', 'withdraw'] as const)(
  '%s derives the actor and retains revision checks',
  async (action) => {
    const store = fixture();
    await actOnTimeSuggestion(store, 'pick', 'actor', id, action, { revision: 0 });
    expect(store.act).toHaveBeenCalledWith('pick', 'actor', id, 0, action);
    expect(store.notifier).toHaveBeenCalledTimes(action === 'accept' ? 1 : 0);
  },
);
test('notification failure cannot fail a committed suggestion or acceptance', async () => {
  const store = fixture();
  store.notifier.mockRejectedValue(new Error('Push down'));
  await expect(
    suggestTime(store, 'pick', 'actor', { revision: 1, planAt: future() }),
  ).resolves.toEqual({ id });
  await expect(
    actOnTimeSuggestion(store, 'pick', 'actor', id, 'accept', { revision: 1 }),
  ).resolves.toEqual({ id });
});
test('stale mutation failure never notifies', async () => {
  const store = fixture();
  store.act.mockRejectedValue(new Error('Stale'));
  await expect(
    actOnTimeSuggestion(store, 'pick', 'actor', id, 'accept', { revision: 1 }),
  ).rejects.toThrow('Stale');
  expect(store.notifier).not.toHaveBeenCalled();
});
test('suggestion requests cannot borrow a replacement account token', async () => {
  const fetch = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>();
  const api = createApiClient({
    baseUrl: 'https://test',
    getAccessToken: async () => 'token',
    getSession: async () => ({ accessToken: 'token', user: { id: 'other', email: null } }),
    fetch,
  });
  await expect(api.suggestTime('p', future(), 1, 'actor')).rejects.toMatchObject({
    code: 'account_changed',
  });
  await expect(api.actOnTimeSuggestion('p', id, 'accept', 1, 'actor')).rejects.toMatchObject({
    code: 'account_changed',
  });
  expect(fetch).not.toHaveBeenCalled();
});

test('versioned RSVP forwards the schedule actually displayed and legacy callers remain unchanged', async () => {
  const rsvpWrite = jest.fn();
  const store = {
    rsvp: rsvpWrite,
    setPlanTime: jest.fn(),
    outcome: jest.fn(),
    loadPlan: jest.fn(),
    history: jest.fn(),
    again: jest.fn(),
    finalistCounts: jest.fn(),
  };
  await rsvp(store, 'p', 'actor', { status: 'going', revision: 3 }, true);
  expect(rsvpWrite).toHaveBeenLastCalledWith('p', 'actor', 'going', 3);
  await rsvp(store, 'p', 'actor', { status: 'going' }, true);
  expect(rsvpWrite).toHaveBeenLastCalledWith('p', 'actor', 'going', null);
  await rsvp(store, 'p', 'actor', { status: 'going' });
  expect(rsvpWrite).toHaveBeenLastCalledWith('p', 'actor', 'going');
});

test('accepted-time notice asks for reconfirmation without putting private time details on the lock screen', () => {
  const text = notificationText('plan_time_set', {
    reconfirmRsvp: true,
    timeSuggestionId: 'private-id',
  });
  expect(text.title).toBe('Plan time changed');
  expect(text.body).toContain('RSVP again');
  expect(JSON.stringify(text)).not.toContain('private-id');
});
