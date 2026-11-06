import { mockPeopleRoute, resetMockPeople } from '@/lib/mock/people';
import { resetMockFriends } from '@/lib/mock/friends';
import { mockBlocks } from '@/lib/mock/store';
beforeEach(() => {
  resetMockPeople();
  resetMockFriends();
  mockBlocks.clear();
});
test('mock discovery shares real mock profile/friend state, including requests and blocks', () => {
  const search = (q: string) =>
    (mockPeopleRoute('GET', `/friends/search?q=${q}`, null)!.body as any).people;
  expect(search('@AVA')[0].relationship).toBe('friends');
  expect(search('jordan')[0].relationship).toBe('incoming');
  expect(search('dana')[0].relationship).toBe('none');
  mockPeopleRoute('POST', '/friends/username-requests', {
    username: 'dana',
    targetId: 'mock-dana',
  });
  expect(search('dana')[0].relationship).toBe('requested');
  mockBlocks.add('mock-dana');
  expect(search('dana')).toEqual([]);
});
test('mock lookup budget is shared between ID lookup and username search', () => {
  for (let i = 0; i < 30; i++)
    expect(mockPeopleRoute('GET', '/people/missing', null)!.status).toBe(404);
  expect(mockPeopleRoute('GET', '/friends/search?q=ava', null)!.status).toBe(429);
});

test('rolling daily lookup quota is shared across routes and expires after 24 hours', () => {
  const clock = jest.spyOn(Date, 'now');
  const now = Date.now();
  try {
    for (let i = 0; i < 150; i++) {
      clock.mockReturnValue(now + i * 60000);
      expect(
        mockPeopleRoute('GET', i % 2 ? '/people/missing' : '/friends/search?q=ava', null)!.status,
      ).not.toBe(429);
    }
    clock.mockReturnValue(now + 151 * 60000);
    expect(mockPeopleRoute('GET', '/people/missing', null)!.status).toBe(429);
    clock.mockReturnValue(now + 86400000);
    expect(mockPeopleRoute('GET', '/people/missing', null)!.status).toBe(404);
  } finally {
    clock.mockRestore();
  }
});
