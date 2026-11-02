// The mock's POST /picks/join follows pick_join's rules through the real API client.
import { createApiClient } from '@/lib/api';
import { MOCK_ACCESS_TOKEN, MOCK_USER_ID } from '@/lib/mock/auth';
import { MOCK_API_BASE_URL, mockFetch } from '@/lib/mock/api';
import { mockQueries } from '@/lib/mock/queries';
import { MOCK_INVITE_CODE, mockPicks, resetMockData, setMockBots } from '@/lib/mock/store';

const api = createApiClient({
  baseUrl: MOCK_API_BASE_URL,
  getAccessToken: async () => MOCK_ACCESS_TOKEN,
  fetch: mockFetch,
});

beforeEach(() => {
  setMockBots(false);
  resetMockData();
});

const members = (id: string) =>
  mockPicks.get(id)!.participants.filter((p) => p.userId === MOCK_USER_ID).length;

test('joining by code adds me once and the Pick shows up in my list', async () => {
  expect((await mockQueries.listMyPicks(MOCK_USER_ID)).map((p) => p.id)).not.toContain(
    'invite-pick',
  );
  await expect(api.joinPick(MOCK_INVITE_CODE.toLowerCase())).resolves.toEqual({
    pickId: 'invite-pick',
  });
  await expect(api.joinPick(` ${MOCK_INVITE_CODE} `)).resolves.toEqual({ pickId: 'invite-pick' });
  expect(members('invite-pick')).toBe(1);
  expect((await mockQueries.listMyPicks(MOCK_USER_ID)).map((p) => p.id)).toContain('invite-pick');
});

test('bad input, unknown codes and closed Picks fail like the server', async () => {
  await expect(api.joinPick('nope')).rejects.toMatchObject({ status: 400 });
  await expect(api.joinPick('ZZZZZZ')).rejects.toMatchObject({
    status: 404,
    code: 'JOIN_CODE_NOT_FOUND',
  });
  mockPicks.get('invite-pick')!.state = 'completed';
  // Same answer as an unknown code (0014): a code's Pick is never confirmed to exist.
  await expect(api.joinPick(MOCK_INVITE_CODE)).rejects.toMatchObject({
    status: 404,
    code: 'JOIN_CODE_NOT_FOUND',
  });
  expect(members('invite-pick')).toBe(0);
});
