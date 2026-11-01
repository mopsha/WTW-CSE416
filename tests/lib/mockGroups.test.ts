// The mock's /groups routes follow 0012_groups.sql's rules through the real API client,
// so mock mode shows the same errors the app gets from the server.
import { createApiClient } from '@/lib/api';
import { addableFriends, groupNameProblem, sortMembers } from '@/lib/groups';
import { MOCK_ACCESS_TOKEN, MOCK_USER_ID } from '@/lib/mock/auth';
import { MOCK_API_BASE_URL, mockFetch } from '@/lib/mock/api';
import { resetMockGroups } from '@/lib/mock/groups';
import { mockQueries } from '@/lib/mock/queries';
import { mockPicks, resetMockData, setMockBots } from '@/lib/mock/store';
import type { CreatePickInput } from '@shared/domain/createPick.ts';

const api = createApiClient({
  baseUrl: MOCK_API_BASE_URL,
  getAccessToken: async () => MOCK_ACCESS_TOKEN,
  fetch: mockFetch,
});

const ROOMMATES = 'mock-group-roommates';
const CLIMBING = 'mock-group-climbing';
const draft = (): CreatePickInput => ({
  category: 'food',
  center: { lat: 40.91, lng: -73.12 },
  radiusM: 3219,
  poolSize: 20,
  deadlineAt: null,
  closeThreshold: 100,
});
const people = (pickId: string) =>
  mockPicks
    .get(pickId)!
    .participants.map((p) => p.userId)
    .sort();

beforeEach(() => {
  setMockBots(false);
  resetMockData();
  resetMockGroups();
});

test('I see the groups I am in, with member names, owner first', async () => {
  const groups = await mockQueries.listMyGroups(MOCK_USER_ID);
  expect(groups.map((g) => [g.name, g.isOwner, g.memberCount])).toEqual([
    ['Climbing crew', false, 3],
    ['Roommates', true, 3],
  ]);
  const detail = await mockQueries.getGroup(ROOMMATES);
  expect(detail!.members.map((m) => [m.displayName, m.role])).toEqual([
    ['You', 'owner'],
    ['Ava', 'member'],
    ['Ben', 'member'],
  ]);
  await expect(mockQueries.getGroup('mock-group-nope')).resolves.toBeNull();
});

test('a group Pick has every member in it and shows up on the group', async () => {
  const { pickId, added } = await api.createGroupPick(draft(), ROOMMATES);
  expect(added).toBe(2);
  expect(people(pickId)).toEqual([MOCK_USER_ID, 'mock-ava', 'mock-ben'].sort());
  expect((await mockQueries.getGroup(ROOMMATES))!.picks.map((p) => p.id)).toEqual([pickId]);
  await expect(api.createGroupPick({ ...draft(), poolSize: 2 }, ROOMMATES)).rejects.toMatchObject({
    status: 400,
    code: 'INVALID_INPUT',
  });
});

test('only friends can be added, and only by the owner', async () => {
  await expect(api.addGroupMembers(ROOMMATES, ['mock-jordan'])).rejects.toMatchObject({
    status: 403,
    code: 'NOT_FRIENDS',
  });
  await expect(api.addGroupMembers(ROOMMATES, ['mock-cam', 'mock-cam'])).resolves.toEqual({
    added: 1,
  });
  await expect(api.addGroupMembers(CLIMBING, ['mock-ben'])).rejects.toMatchObject({
    status: 403,
    code: 'FORBIDDEN',
  });
  await expect(api.addGroupMembers(ROOMMATES, [])).rejects.toMatchObject({ status: 400 });
});

test('a removed member keeps the old Pick but is not in the next one', async () => {
  const first = await api.createGroupPick(draft(), ROOMMATES);
  await api.removeGroupMember(ROOMMATES, 'mock-ben');
  const second = await api.createGroupPick(draft(), ROOMMATES);
  expect(people(first.pickId)).toContain('mock-ben');
  expect(people(second.pickId)).not.toContain('mock-ben');
  expect(second.added).toBe(1);
});

test('leaving hides the group; the owner must delete instead', async () => {
  await expect(api.leaveGroup(ROOMMATES)).rejects.toMatchObject({
    status: 409,
    code: 'OWNER_CANNOT_LEAVE',
  });
  await api.leaveGroup(CLIMBING);
  await expect(mockQueries.getGroup(CLIMBING)).resolves.toBeNull();
  await expect(api.createGroupPick(draft(), CLIMBING)).rejects.toMatchObject({
    status: 404,
    code: 'GROUP_NOT_FOUND',
  });
});

test('create, rename and delete', async () => {
  const created = await api.createGroup('  Study group ');
  expect(created).toMatchObject({ name: 'Study group', ownerId: MOCK_USER_ID });
  await expect(api.createGroup(' ')).rejects.toMatchObject({ status: 400 });
  await api.renameGroup(created.id, 'Finals week');
  expect((await mockQueries.getGroup(created.id))!.name).toBe('Finals week');
  await expect(api.renameGroup(CLIMBING, 'Mine')).rejects.toMatchObject({ status: 403 });
  await api.deleteGroup(created.id);
  await expect(mockQueries.getGroup(created.id)).resolves.toBeNull();
});

test('inviting friends to a Pick: host only, friends only, until swiping ends', async () => {
  const { pickId } = await api.createPick(draft());
  await expect(api.inviteToPick(pickId, ['mock-jordan'])).rejects.toMatchObject({
    code: 'NOT_FRIENDS',
  });
  await expect(api.inviteToPick(pickId, ['mock-ava'])).resolves.toEqual({ added: 1 });
  mockPicks.get(pickId)!.state = 'completed';
  await expect(api.inviteToPick(pickId, ['mock-ben'])).rejects.toMatchObject({
    status: 409,
    code: 'PICK_CLOSED',
  });
});

test('helpers: name rule matches the API, addable friends skip members', () => {
  expect(groupNameProblem('  ')).not.toBeNull();
  expect(groupNameProblem('x'.repeat(51))).not.toBeNull();
  expect(groupNameProblem('😀'.repeat(50))).toBeNull();
  const members = sortMembers([
    { userId: 'b', displayName: 'Ben', role: 'member' },
    { userId: 'z', displayName: 'Zed', role: 'owner' },
    { userId: 'a', displayName: 'Ava', role: 'member' },
  ]);
  expect(members.map((m) => m.userId)).toEqual(['z', 'a', 'b']);
  expect(
    addableFriends(
      [
        { userId: 'c', displayName: 'Cam' },
        { userId: 'a', displayName: 'Ava' },
      ],
      members,
    ),
  ).toEqual([{ userId: 'c', displayName: 'Cam' }]);
});
