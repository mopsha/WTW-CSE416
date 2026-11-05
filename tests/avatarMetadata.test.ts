const mockRpc = jest.fn();
jest.mock('../supabase/functions/api/serviceClient.ts', () => ({
  createServiceClient: () => ({ rpc: mockRpc }),
}));
const { avatarMetadata } = jest.requireActual<{
  avatarMetadata(viewer: string, ids: string[]): Promise<Record<string, unknown>>;
}>('../supabase/functions/api/avatarMetadata.ts');

beforeEach(() => mockRpc.mockReset());
test('batches duplicate sender identities using the actual viewer and preserves authorized null photos', async () => {
  const result = { friend: { revision: 2, avatarRef: null } };
  mockRpc
    .mockResolvedValueOnce({ data: true, error: null })
    .mockResolvedValueOnce({ data: result, error: null });
  await expect(avatarMetadata('viewer', ['friend', 'friend', 'blocked'])).resolves.toEqual(result);
  expect(mockRpc).toHaveBeenCalledTimes(2);
  expect(mockRpc).toHaveBeenCalledWith('avatar_refs', {
    p_viewer_id: 'viewer',
    p_target_ids: ['friend', 'blocked'],
  });
});
test('empty histories need no query; metadata failures preserve existing features without leaking details', async () => {
  await expect(avatarMetadata('viewer', [])).resolves.toEqual({});
  expect(mockRpc).not.toHaveBeenCalled();
  mockRpc.mockResolvedValue({ data: null, error: { message: 'SECRET', code: 'XX000' } });
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    await expect(avatarMetadata('viewer', ['friend'])).resolves.toEqual({});
    expect(warn).toHaveBeenCalledWith('Photo metadata unavailable');
  } finally {
    warn.mockRestore();
  }
});

test('exhausted shared resolution budget omits optional photos without querying identities', async () => {
  mockRpc.mockResolvedValue({ data: false, error: null });
  await expect(avatarMetadata('viewer', ['friend'])).resolves.toEqual({});
  expect(mockRpc).toHaveBeenCalledTimes(1);
  expect(mockRpc).toHaveBeenCalledWith('consume_avatar_limit', {
    p_user_id: 'viewer',
    p_kind: 'avatar_resolve',
  });
});
