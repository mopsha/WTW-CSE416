import { MOCK_API_BASE_URL, mockFetch } from '@/lib/mock/api';
import { createApiClient } from '@/lib/api';
import { mockPicks, resetMockData, setMockBots } from '@/lib/mock/store';
import { MOCK_ACCESS_TOKEN, MOCK_USER_ID } from '@/lib/mock/auth';
import { DEMO_CENTER } from '@/lib/mock/fixtures';
const api = createApiClient({
  baseUrl: MOCK_API_BASE_URL,
  getAccessToken: async () => MOCK_ACCESS_TOKEN,
  fetch: mockFetch,
});
beforeEach(() => {
  setMockBots(false);
  resetMockData();
});
afterAll(() => setMockBots(true));
test('bug #11: new Activities Picks start and refresh with activity fixtures', async () => {
  const { pickId } = await api.createPick({
    category: 'activities',
    center: DEMO_CENTER,
    radiusM: 16000,
    poolSize: 10,
    deadlineAt: null,
    closeThreshold: 100,
  });
  const pick = mockPicks.get(pickId)!;
  pick.participants.push({ userId: 'friend', name: 'Friend', answers: new Map(), vote: null });
  await api.startPick(pickId);
  expect(pick.candidates).toHaveLength(10);
  expect(pick.candidates.every((p) => p.placeId.startsWith('sbu-act-'))).toBe(true);
  await api.refreshPick(pickId);
  expect(pick.candidates.every((p) => p.placeId.startsWith('sbu-act-'))).toBe(true);
  expect(pick.hostId).toBe(MOCK_USER_ID);
});
test('preexisting friend Activities Pick uses activity fixtures', () => {
  expect(
    mockPicks.get('friend-pick')!.candidates.every((p) => p.placeId.startsWith('sbu-act-')),
  ).toBe(true);
});
test('save is idempotent, list and delete round trip', async () => {
  await api.savePlace('sbu-act-01');
  await api.savePlace('sbu-act-01');
  expect((await api.getSaved()).places.filter((p) => p.placeId === 'sbu-act-01')).toHaveLength(1);
  await api.removeSaved('sbu-act-01');
  await api.removeSaved('sbu-act-01');
  expect((await api.getSaved()).places.some((p) => p.placeId === 'sbu-act-01')).toBe(false);
});
