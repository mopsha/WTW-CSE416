import type { GroupIdeasStore } from '@shared/api/groupIdeas.ts';
const mockRpc = jest.fn();
jest.mock('../supabase/functions/api/serviceClient.ts', () => ({
  createServiceClient: () => ({ rpc: mockRpc }),
}));
const { createGroupIdeasStore } = jest.requireActual<{ createGroupIdeasStore(): GroupIdeasStore }>(
  '../supabase/functions/api/groupIdeasStore.ts',
);
const row = {
  id: 'idea',
  group_id: 'group',
  created_by: 'creator',
  name: 'Dinner',
  category: 'food',
  description: null,
  location_text: 'Home',
  created_at: 'created',
  updated_at: 'updated',
};
beforeEach(() => mockRpc.mockReset());
test('maps DB rows and uses exact SQL arguments for every action', async () => {
  const store = createGroupIdeasStore();
  mockRpc.mockResolvedValue({ data: [row], error: null });
  expect(await store.list('user', 'group')).toEqual([
    {
      id: 'idea',
      groupId: 'group',
      createdBy: 'creator',
      name: 'Dinner',
      category: 'food',
      description: null,
      locationText: 'Home',
      createdAt: 'created',
      updatedAt: 'updated',
    },
  ]);
  expect(mockRpc).toHaveBeenLastCalledWith('group_ideas', {
    p_action: 'list',
    p_user_id: 'user',
    p_group_id: 'group',
    p_idea_id: null,
    p_input: {},
  });
  mockRpc.mockResolvedValue({ data: row, error: null });
  const input = { name: 'Dinner', category: 'food' as const };
  await store.create('user', 'group', input);
  expect(mockRpc).toHaveBeenLastCalledWith('group_ideas', {
    p_action: 'create',
    p_user_id: 'user',
    p_group_id: 'group',
    p_idea_id: null,
    p_input: input,
  });
  await store.get('user', 'group', 'idea');
  expect(mockRpc.mock.lastCall[1]).toMatchObject({ p_action: 'get', p_idea_id: 'idea' });
  await store.update('user', 'group', 'idea', input);
  expect(mockRpc.mock.lastCall[1]).toMatchObject({
    p_action: 'update',
    p_idea_id: 'idea',
    p_input: input,
  });
  await store.delete('user', 'group', 'idea');
  expect(mockRpc.mock.lastCall[1]).toMatchObject({ p_action: 'delete', p_idea_id: 'idea' });
});
test.each([
  ['PT404', 404],
  ['PT403', 403],
  ['PT400', 400],
  ['23514', 400],
  ['PGRST202', 503],
])('sanitizes %s as %s', async (code, status) => {
  mockRpc.mockResolvedValue({ data: null, error: { code, message: 'PRIVATE database detail' } });
  await expect(createGroupIdeasStore().list('user', 'group')).rejects.toMatchObject({ status });
  await expect(createGroupIdeasStore().list('user', 'group')).rejects.not.toThrow('PRIVATE');
});
