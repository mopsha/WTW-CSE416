import { errorResponse } from '@shared/api/errors.ts';
import type { GroupsStore } from '@shared/api/groups.ts';

const mockRpc = jest.fn();
const mockMaybeSingle = jest.fn();
const mockEq = jest.fn();
jest.mock('../supabase/functions/api/serviceClient.ts', () => ({
  createServiceClient: () => ({
    rpc: mockRpc,
    from: () => ({ select: () => ({ eq: mockEq }) }),
  }),
}));
// Load the adapter with its Deno-only service client mocked, keeping app tsc separate.
const { createGroupsStore } = jest.requireActual<{ createGroupsStore(): GroupsStore }>(
  '../supabase/functions/api/groupsStore.ts',
);

beforeEach(() => {
  mockRpc.mockReset();
  mockMaybeSingle.mockReset();
  mockEq.mockReset();
  mockEq.mockImplementation(() => ({ eq: mockEq, maybeSingle: mockMaybeSingle }));
});

test('calls the 0012 RPCs with their SQL argument names', async () => {
  mockRpc.mockResolvedValue({ data: 2, error: null });
  const store = createGroupsStore();
  await store.addMembers('me', 'g1', ['a', 'b']);
  expect(mockRpc).toHaveBeenLastCalledWith('group_add_members', {
    p_user_id: 'me',
    p_group_id: 'g1',
    p_user_ids: ['a', 'b'],
  });
  await expect(store.addGroupToPick('p1', 'me', 'g1')).resolves.toBe(2);
  expect(mockRpc).toHaveBeenLastCalledWith('pick_add_group', {
    p_pick_id: 'p1',
    p_user_id: 'me',
    p_group_id: 'g1',
  });
  await store.invite('p1', 'me', ['a']);
  expect(mockRpc).toHaveBeenLastCalledWith('pick_invite', {
    p_pick_id: 'p1',
    p_user_id: 'me',
    p_user_ids: ['a'],
  });
  await store.removeMember('me', 'g1', 'a');
  expect(mockRpc).toHaveBeenLastCalledWith('group_remove_member', {
    p_user_id: 'me',
    p_group_id: 'g1',
    p_member_id: 'a',
  });
});

test('isMember reads group_members for exactly that group and user', async () => {
  mockMaybeSingle.mockResolvedValueOnce({ data: { user_id: 'me' }, error: null });
  await expect(createGroupsStore().isMember('g1', 'me')).resolves.toBe(true);
  expect(mockEq).toHaveBeenNthCalledWith(1, 'group_id', 'g1');
  expect(mockEq).toHaveBeenNthCalledWith(2, 'user_id', 'me');
  mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
  await expect(createGroupsStore().isMember('g1', 'stranger')).resolves.toBe(false);
});

test.each([
  ['PT404', 'group_not_found', 404, 'GROUP_NOT_FOUND'],
  ['PT403', 'not_owner', 403, 'FORBIDDEN'],
  ['PT403', 'not_friends', 403, 'NOT_FRIENDS'],
  ['PT400', 'invalid_name', 400, 'INVALID_INPUT'],
  ['PT409', 'group_full', 409, 'GROUP_FULL'],
  ['PT409', 'owner_cannot_leave', 409, 'OWNER_CANNOT_LEAVE'],
  ['PT409', 'pick_closed', 409, 'PICK_CLOSED'],
  ['PT403', 'not_host', 403, 'FORBIDDEN'],
  ['PGRST202', null, 503, 'DATABASE_NOT_READY'],
  ['PT403', 'unknown_hint', 500, 'INTERNAL_ERROR'],
  ['XX000', null, 500, 'INTERNAL_ERROR'],
])('maps %s / %s to HTTP %s %s without leaking details', async (code, hint, status, apiCode) => {
  mockRpc.mockResolvedValue({ data: null, error: { code, hint, message: 'secret DB details' } });
  const error = await createGroupsStore()
    .addMembers('me', 'g1', ['a'])
    .catch((e: unknown) => e);
  const response = errorResponse(error);
  expect(response.status).toBe(status);
  expect(response.body.error.code).toBe(apiCode);
  expect(JSON.stringify(response)).not.toContain('secret DB details');
});
