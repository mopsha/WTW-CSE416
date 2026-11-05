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
