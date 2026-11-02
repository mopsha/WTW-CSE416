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

const pickInput = {
  category: 'food',
  center: { lat: 40, lng: -73 },
  radiusM: 5000,
  poolSize: 5,
  deadlineAt: null,
  closeThreshold: 100,
};
test('Hang Pick uses the canonical adapter and retries the existing idempotent notifier for exactly included participants', async () => {
  const notifier = jest.fn();
  const createPickForDown = jest
    .fn()
    .mockResolvedValue({ pickId: 'new', participantIds: ['b', 'c'], created: true });
  const deps = { ...store(), createPickForDown, notifier };
  await expect(hangPick(deps, 'post', 'author', now, pickInput)).resolves.toEqual({
    pickId: 'new',
    isParticipant: false,
  });
  expect(createPickForDown).toHaveBeenCalledWith(
    'post',
    'author',
    expect.objectContaining(pickInput),
  );
  expect(notifier).toHaveBeenCalledWith(['b', 'c'], 'added_to_pick', 'new');
  createPickForDown.mockResolvedValue({
    pickId: 'new',
    participantIds: ['b', 'c'],
    created: false,
  });
  await hangPick(deps, 'post', 'author', now, pickInput);
  expect(notifier).toHaveBeenCalledTimes(2);
});
test('invalid settings and nonauthor Pick requests never reach the creation adapter', async () => {
  const createPickForDown = jest.fn();
  const deps = { ...store(), createPickForDown };
  await expect(hangPick(deps, 'post', 'author', now, {})).rejects.toMatchObject({ status: 400 });
  await expect(hangPick(deps, 'post', 'friend', now, pickInput)).rejects.toMatchObject({
    status: 403,
  });
  expect(createPickForDown).not.toHaveBeenCalled();
});
test('authorized response uses the atomic upsert adapter; invalid status never writes', async () => {
  const respondAuthorized = jest.fn();
  const deps = {
    ...store(),
    access: async () => ({ ...no, acceptedFriends: true }),
    respondAuthorized,
  };
  await respondHang(deps, 'post', 'friend', { status: 'down' }, now);
  await respondHang(deps, 'post', 'friend', { status: 'maybe' }, now);
  expect(respondAuthorized.mock.calls).toEqual([
    ['post', 'friend', 'down'],
    ['post', 'friend', 'maybe'],
  ]);
  await expect(respondHang(deps, 'post', 'friend', { status: 'yes' }, now)).rejects.toMatchObject({
    status: 400,
  });
  expect(respondAuthorized).toHaveBeenCalledTimes(2);
});
