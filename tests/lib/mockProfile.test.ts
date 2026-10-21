// My display name comes from my profile (profiles.display_name in mock form) and shows
// where friends see me (progress).
import { MOCK_USER_ID } from '@/lib/mock/auth';
import { mockQueries } from '@/lib/mock/queries';
import { mockPicks, mockProfile, progressOf, resetMockData, setMockBots } from '@/lib/mock/store';

beforeEach(() => {
  setMockBots(false);
  resetMockData();
  mockProfile.displayName = null;
});

test('a mock account without a name reads back null, so screens use the email', async () => {
  await expect(mockQueries.getMyProfile(MOCK_USER_ID)).resolves.toEqual({ displayName: null });
});

test('a set name reads back and shows in Pick progress', async () => {
  mockProfile.displayName = 'Mike';
  await expect(mockQueries.getMyProfile(MOCK_USER_ID)).resolves.toEqual({ displayName: 'Mike' });
  const pick = [...mockPicks.values()].find((p) =>
    p.participants.some((x) => x.userId === MOCK_USER_ID),
  )!;
  expect(progressOf(pick).participants.find((p) => p.isMe)?.displayName).toBe('Mike');
});
