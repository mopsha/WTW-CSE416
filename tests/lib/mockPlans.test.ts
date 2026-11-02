// The mock's plan / RSVP / outcome / reasons / history / Pick-again routes follow the API
// contract through the real client, so the Winner and History screens work in mock mode.
import { createApiClient } from '@/lib/api';
import { MOCK_ACCESS_TOKEN, MOCK_USER_ID } from '@/lib/mock/auth';
import { MOCK_API_BASE_URL, mockFetch, mockNotifications } from '@/lib/mock/api';
import { mockPicks, resetMockData, setMockBots } from '@/lib/mock/store';

const api = createApiClient({
  baseUrl: MOCK_API_BASE_URL,
  getAccessToken: async () => MOCK_ACCESS_TOKEN,
  fetch: mockFetch,
});

beforeEach(() => {
  setMockBots(false);
  resetMockData();
});

const inAnHour = () => new Date(Date.now() + 3_600_000).toISOString();

test('the decided fixture Pick: time, RSVP, outcome, all counts only', async () => {
  const before = await api.getPlan('done-pick');
  expect(before).toMatchObject({ state: 'completed', isHost: true, planAt: null, myRsvp: null });

  const planAt = inAnHour();
  await expect(api.setPlanTime('done-pick', planAt)).resolves.toEqual({ planAt });
  await api.rsvp('done-pick', 'going');
  await api.recordOutcome('done-pick', true, true);

  const after = await api.getPlan('done-pick');
  expect(after).toMatchObject({
    planAt,
    myRsvp: 'going',
    rsvps: { going: 1, maybe: 0, notGoing: 0 },
    myOutcome: { went: true, again: true },
    outcomes: { went: 1, didNotGo: 0, again: 1 },
  });
});

test('same errors as the API: wrong step, bad input', async () => {
  await expect(api.rsvp('demo-pick', 'going')).rejects.toMatchObject({ status: 409 });
  await expect(api.setPlanTime('done-pick', '2020-01-01T00:00:00Z')).rejects.toMatchObject({
    status: 400,
  });
  await expect(api.getReasons('demo-pick')).rejects.toMatchObject({ status: 409 });
});

test('reasons: words for the top three, no numbers', async () => {
  const { reasons } = await api.getReasons('done-pick');
  expect(reasons.length).toBeGreaterThan(0);
  expect(reasons.length).toBeLessThanOrEqual(3);
  expect(reasons.map((r) => r.rank)).toEqual([...reasons.map((r) => r.rank)].sort());
  for (const r of reasons) expect(r.reason).not.toMatch(/\d/);
});

test('history lists completed Picks I was in; Pick again copies people and settings', async () => {
  const { picks } = await api.getHistory();
  expect(picks.map((p) => p.id)).toContain('done-pick');
  expect(picks.find((p) => p.id === 'done-pick')!.winner).not.toBeNull();

  const { pickId } = await api.pickAgain('done-pick');
  const next = mockPicks.get(pickId)!;
  const old = mockPicks.get('done-pick')!;
  expect(next).toMatchObject({ state: 'draft', hostId: MOCK_USER_ID, category: old.category });
  expect(next.participants.map((p) => p.userId).sort()).toEqual(
    old.participants.map((p) => p.userId).sort(),
  );
  expect(next.participants.every((p) => p.answers.size === 0)).toBe(true);
  // A second tap goes to the same draft instead of making another.
  expect((await api.pickAgain('done-pick')).pickId).toBe(pickId);
  await expect(api.getHistory('0f8fad5b-d9cb-469f-a165-70867728950e')).rejects.toMatchObject({
    status: 404,
  });
});

test('inbox and cancel reason', async () => {
  const inbox = await api.listNotifications();
  expect(inbox.unreadCount).toBe(mockNotifications.filter((n) => !n.readAt).length);
  await api.markNotificationRead('mock-n-vote');
  expect((await api.listNotifications()).unreadCount).toBe(inbox.unreadCount - 1);
  await expect(api.markNotificationRead('nope')).rejects.toMatchObject({ status: 404 });
  await expect(api.cancelPick('demo-pick', 'x'.repeat(201))).rejects.toMatchObject({ status: 400 });
  await expect(api.cancelPick('demo-pick', 'Rained out')).resolves.toEqual({ state: 'canceled' });
});
