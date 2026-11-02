import { errorResponse } from '@shared/api/errors.ts';
import type { InviteStore } from '@shared/api/invites.ts';
import type { SafetyStore } from '@shared/api/safety.ts';

const mockRpc = jest.fn();
jest.mock('../supabase/functions/api/serviceClient.ts', () => ({
  createServiceClient: () => ({ rpc: mockRpc }),
}));
// Load the adapters with their Deno-only service client mocked, keeping app tsc separate.
const { createSafetyStore } = jest.requireActual<{ createSafetyStore(): SafetyStore }>(
  '../supabase/functions/api/safetyStore.ts',
);
const { createInviteStore } = jest.requireActual<{ createInviteStore(): InviteStore }>(
  '../supabase/functions/api/inviteStore.ts',
);
const { takeFriendRequestLimit } = jest.requireActual<{
  takeFriendRequestLimit(userId: string): Promise<boolean>;
}>('../supabase/functions/api/friendRequestLimit.ts');

beforeEach(() => mockRpc.mockReset());
const errorOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => errorResponse(e),
  );

test('calls the 0014 RPCs with their SQL argument names', async () => {
  mockRpc.mockResolvedValue({ data: true, error: null });
  await createSafetyStore().block('me', 'them');
  expect(mockRpc).toHaveBeenLastCalledWith('block_user', { p_user_id: 'me', p_target_id: 'them' });
  await createSafetyStore().report('me', { kind: 'pick', targetId: 'p', reason: 'r' });
  expect(mockRpc).toHaveBeenLastCalledWith('report_create', {
    p_user_id: 'me',
    p_kind: 'pick',
    p_target_id: 'p',
    p_reason: 'r',
  });
  await expect(createSafetyStore().setLobbyLocked('p', 'me', true)).resolves.toBe(true);
  expect(mockRpc).toHaveBeenLastCalledWith('pick_set_lobby_locked', {
    p_pick_id: 'p',
    p_user_id: 'me',
    p_locked: true,
  });
  await expect(takeFriendRequestLimit('me')).resolves.toBe(true);
  expect(mockRpc).toHaveBeenLastCalledWith('rate_limit_take', {
    p_user_id: 'me',
    p_action: 'friend_request',
  });
});

test.each([
  ['PT400', 400],
  ['PT403', 403],
  ['PT404', 404],
  ['PT409', 409],
  ['PT429', 429],
  ['PGRST202', 503],
  ['XX000', 500],
])('maps %s to HTTP %s without leaking details', async (code, status) => {
  mockRpc.mockResolvedValue({ data: null, error: { code, message: 'secret DB details' } });
  const response = await errorOf(
    createSafetyStore().report('me', { kind: 'user', targetId: 'u', reason: 'r' }),
  );
  expect(response?.status).toBe(status);
  expect(JSON.stringify(response)).not.toContain('secret DB details');
});

test('invite_accept statuses: ok, the generic 404, and 429', async () => {
  mockRpc.mockResolvedValue({ data: { ok: true, kind: 'pick', targetId: 'p' }, error: null });
  await expect(createInviteStore().accept('t', 'me')).resolves.toEqual({
    kind: 'pick',
    targetId: 'p',
  });
  expect(mockRpc).toHaveBeenLastCalledWith('invite_accept', { p_token: 't', p_user_id: 'me' });

  mockRpc.mockResolvedValue({ data: { ok: false, reason: 'invalid' }, error: null });
  const invalid = await errorOf(createInviteStore().accept('t', 'me'));
  expect(invalid?.body.error.code).toBe('INVITE_NOT_FOUND');

  mockRpc.mockResolvedValue({ data: { ok: false, reason: 'rate_limited' }, error: null });
  expect((await errorOf(createInviteStore().accept('t', 'me')))?.status).toBe(429);
});

test('invite_create and invite_revoke', async () => {
  const link = { token: 't', kind: 'pick', targetId: 'p', expiresAt: 'x', maxUses: 3 };
  mockRpc.mockResolvedValue({ data: link, error: null });
  await expect(
    createInviteStore().create('me', { kind: 'pick', targetId: 'p', maxUses: 3 }),
  ).resolves.toEqual(link);
  expect(mockRpc).toHaveBeenLastCalledWith('invite_create', {
    p_user_id: 'me',
    p_kind: 'pick',
    p_target_id: 'p',
    p_max_uses: 3,
  });
  mockRpc.mockResolvedValue({ data: null, error: { code: 'PT404' } });
  expect((await errorOf(createInviteStore().revoke('t', 'me')))?.status).toBe(404);
});
