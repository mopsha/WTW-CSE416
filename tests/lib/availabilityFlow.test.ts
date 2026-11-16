import { createApiClient, type FetchLike } from '@/lib/api';
import type { AuthSession } from '@/lib/auth';
import { mockFetch, MOCK_API_BASE_URL } from '@/lib/mock/api';
import { MOCK_ACCESS_TOKEN, MOCK_USER_ID } from '@/lib/mock/auth';
import { mockPicks, resetMockData, setMockBots } from '@/lib/mock/store';
const input = () => ({
  category: 'food' as const,
  center: { lat: 40.9126, lng: -73.1234 },
  radiusM: 3219,
  poolSize: 20,
  closeThreshold: 100,
  deadlineAt: null,
  proposedAt: new Date(Date.now() + 2 * 86400000).toISOString(),
  swipeDeadlineMinutes: 60,
});
const owner: AuthSession = {
  user: { id: MOCK_USER_ID, email: null },
  accessToken: MOCK_ACCESS_TOKEN,
};
const client = () =>
  createApiClient({
    baseUrl: MOCK_API_BASE_URL,
    getAccessToken: async () => MOCK_ACCESS_TOKEN,
    getSession: async () => owner,
    fetch: mockFetch,
  });
beforeEach(() => {
  setMockBots(false);
  resetMockData();
});
afterAll(() => setMockBots(true));
test('mock scheduled flow retains invitees, locks Yes/Maybe cohort and carries time into results', async () => {
  const api = client();
  const settings = input();
  const { pickId } = await api.createPick(settings);
  const pick = mockPicks.get(pickId)!;
  expect((await api.getPick(pickId)).availability?.revision).toBe(1);
  for (const userId of ['yes', 'maybe', 'cant', 'awaiting'])
    pick.participants.push({ userId, name: userId, answers: new Map(), vote: null });
  pick.availability!.participants.push(
    { userId: 'yes', displayName: 'Yes', response: 'yes' },
    { userId: 'maybe', displayName: 'Maybe', response: 'maybe' },
    { userId: 'cant', displayName: 'Cant', response: 'cant' },
  );
  const start = Date.now();
  await api.startPick(pickId);
  await api.startPick(pickId);
  expect(pick.availability?.cohortUserIds).toEqual([MOCK_USER_ID, 'yes', 'maybe']);
  expect(pick.participants).toHaveLength(5);
  expect(Date.parse(pick.deadlineAt!)).toBeGreaterThanOrEqual(start + 60 * 60000);
  expect((await api.getProgress(pickId)).total).toBe(3);
  await expect(api.respondAvailability(pickId, 1, 'cant', MOCK_USER_ID)).rejects.toMatchObject({
    status: 409,
  });
  await api.closePick(pickId);
  if (pick.state === 'final_vote') await api.closeVote(pickId);
  expect((await api.getPlan(pickId)).planAt).toBe(settings.proposedAt);
  expect((await api.getPlan(pickId)).myOutcome).toBeNull();
});
test('missing/disabled backend capability never silently creates an unscheduled Pick', async () => {
  const fetch = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>(
    async () => new Response(JSON.stringify({ availabilityFirst: false }), { status: 200 }),
  );
  const api = createApiClient({
    baseUrl: 'https://test',
    getAccessToken: async () => MOCK_ACCESS_TOKEN,
    fetch,
  });
  await expect(api.createPick(input())).rejects.toMatchObject({ code: 'availability_not_enabled' });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]![1].method).toBe('GET');
});
test('availability cannot borrow another account token', async () => {
  const fetch = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>();
  const api = createApiClient({
    baseUrl: 'https://test',
    getAccessToken: async () => MOCK_ACCESS_TOKEN,
    getSession: async () => ({ ...owner, user: { id: 'other', email: null } }),
    fetch,
  });
  await expect(api.respondAvailability('p', 1, 'yes', MOCK_USER_ID)).rejects.toMatchObject({
    code: 'account_changed',
  });
  expect(fetch).not.toHaveBeenCalled();
});

test('account change during capability discovery prevents sending the scheduled creation payload', async () => {
  let account = owner;
  let entered!: () => void;
  const reached = new Promise<void>((r) => {
    entered = r;
  });
  let resolveCapability!: (r: Response) => void;
  const capability = new Promise<Response>((r) => {
    resolveCapability = r;
  });
  const fetch = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>(async () => {
    entered();
    return capability;
  });
  const api = createApiClient({
    baseUrl: 'https://test',
    getAccessToken: async () => MOCK_ACCESS_TOKEN,
    getSession: async () => account,
    fetch,
  });
  const pending = api.createPick(input(), MOCK_USER_ID);
  await reached;
  account = { ...owner, user: { id: 'replacement', email: null } };
  resolveCapability(new Response(JSON.stringify({ availabilityFirst: true }), { status: 200 }));
  await expect(pending).rejects.toMatchObject({ code: 'account_changed' });
  expect(fetch).toHaveBeenCalledTimes(1);
});
