import {
  canSeeHang,
  downUserIds,
  hangPick,
  parseHang,
  respondHang,
  type HangPost,
  type HangStore,
} from '@shared/api/hang.ts';
const now = new Date('2026-10-28T12:00:00Z');
const post: HangPost = {
  id: 'post',
  authorId: 'author',
  activity: 'Game night',
  audience: 'all_friends',
  groupId: null,
  startsAt: '2026-10-28T13:00:00Z',
  expiresAt: '2026-10-28T17:00:00Z',
};
const no = { blocked: false, acceptedFriends: false, groupMember: false };
test('visibility contract: accepted friends only, group members only, bidirectional blocks override both', () => {
  expect(canSeeHang(post, 'friend', { ...no, acceptedFriends: true }, now)).toBe(true);
  expect(canSeeHang(post, 'pending', no, now)).toBe(false);
  expect(
    canSeeHang({ ...post, audience: 'group' }, 'friend', { ...no, acceptedFriends: true }, now),
  ).toBe(false);
  expect(
    canSeeHang({ ...post, audience: 'group' }, 'member', { ...no, groupMember: true }, now),
  ).toBe(true);
  for (const audience of ['group', 'all_friends'] as const)
    expect(
      canSeeHang(
        { ...post, audience },
        'blocked',
        { blocked: true, acceptedFriends: true, groupMember: true },
        now,
      ),
    ).toBe(false);
});
test('expiry is exclusive, including author; invalid expiry denied', () => {
  expect(canSeeHang(post, 'author', no, new Date(post.expiresAt))).toBe(false);
  expect(
    canSeeHang({ ...post, expiresAt: 'invalid' }, 'friend', { ...no, acceptedFriends: true }, now),
  ).toBe(false);
});
test('only down responders selected exactly, no automatic author insertion', () => {
  expect(
    downUserIds([
      { userId: 'b', status: 'down' },
      { userId: 'a', status: 'down' },
      { userId: 'c', status: 'maybe' },
      { userId: 'd', status: 'cant' },
    ]),
  ).toEqual(['a', 'b']);
});
function store(): HangStore {
  return { create: jest.fn(), listOwn: async () => [], load: async () => post };
}
test('production dependency gaps fail closed instead of duplicating friend or Pick invitation systems', async () => {
  await expect(
    respondHang(store(), 'post', 'friend', { status: 'down' }, now),
  ).rejects.toMatchObject({ status: 503, code: 'HANG_RELATIONSHIPS_UNAVAILABLE' });
  await expect(hangPick(store(), 'post', 'author', now)).rejects.toMatchObject({
    status: 503,
    code: 'HANG_PICK_HELPER_UNAVAILABLE',
  });
  await expect(hangPick(store(), 'post', 'friend', now)).rejects.toMatchObject({ status: 403 });
});
test('respond authorization rejects blocked/group outsiders and expired posts before writes', async () => {
  const respondAuthorized = jest.fn();
  const deps = { ...store(), access: async () => ({ ...no, blocked: true }), respondAuthorized };
  await expect(respondHang(deps, 'post', 'friend', { status: 'down' }, now)).rejects.toMatchObject({
    status: 404,
  });
  await expect(
    respondHang(
      { ...deps, access: async () => ({ ...no, acceptedFriends: true }) },
      'post',
      'friend',
      { status: 'down' },
      new Date(post.expiresAt),
    ),
  ).rejects.toMatchObject({ status: 404 });
  expect(respondAuthorized).not.toHaveBeenCalled();
});
test('input validation checks audience, group, times and activity', () => {
  expect(parseHang(post, now).activity).toBe('Game night');
  for (const change of [
    { activity: '' },
    { activity: 'a'.repeat(61) },
    { expiresAt: post.startsAt },
    { audience: 'public' },
    { audience: 'group', groupId: null },
  ])
    expect(() => parseHang({ ...post, ...change }, now)).toThrow();
});
