// The mock's invite links, lobby lock and blocks follow 0014's rules through the real client.
import { createApiClient } from '@/lib/api';
import { MOCK_ACCESS_TOKEN, MOCK_USER_ID } from '@/lib/mock/auth';
import { MOCK_API_BASE_URL, mockFetch } from '@/lib/mock/api';
import { mockQueries } from '@/lib/mock/queries';
import {
  createMockInvite,
  MOCK_INVITE_CODE,
  mockPicks,
  resetMockData,
  setMockBots,
} from '@/lib/mock/store';
import { parseInviteToken } from '@shared/domain/inviteLink.ts';

const api = createApiClient({
  baseUrl: MOCK_API_BASE_URL,
  getAccessToken: async () => MOCK_ACCESS_TOKEN,
  fetch: mockFetch,
});

beforeEach(() => {
  setMockBots(false);
  resetMockData();
});

const inPick = (id: string) =>
  mockPicks.get(id)!.participants.some((p) => p.userId === MOCK_USER_ID);

test('the host makes a wtw://i/ link; only hosts can', async () => {
  const link = await api.createInvite({ kind: 'pick', targetId: 'demo-pick' });
  expect(parseInviteToken(link.token)).toBe(link.token);
  expect(link.url).toBe(`wtw://i/${link.token}`);
  await expect(api.createInvite({ kind: 'pick', targetId: 'invite-pick' })).rejects.toMatchObject({
    status: 403,
  });
});

test('accepting a link joins; a revoked or unknown link is the same 404', async () => {
  const token = createMockInvite(mockPicks.get('invite-pick')!);
  await expect(api.acceptInvite(token)).resolves.toEqual({ kind: 'pick', targetId: 'invite-pick' });
  expect(inPick('invite-pick')).toBe(true);
  await api.revokeInvite(token);
  const revoked = await api.acceptInvite(token).catch((e: unknown) => e);
  const unknown = await api.acceptInvite('A'.repeat(22)).catch((e: unknown) => e);
  expect(revoked).toMatchObject({ status: 404, code: 'INVITE_NOT_FOUND' });
  expect(unknown).toMatchObject({ status: 404, code: 'INVITE_NOT_FOUND' });
});

test('a locked lobby admits nobody new by code or link', async () => {
  await expect(api.setLobbyLocked('demo-pick', true)).resolves.toEqual({ locked: true });
  await expect(mockQueries.getLobbyLocked('demo-pick')).resolves.toBe(true);
  mockPicks.get('invite-pick')!.lobbyLocked = true;
  await expect(api.joinPick(MOCK_INVITE_CODE)).rejects.toMatchObject({
    code: 'JOIN_CODE_NOT_FOUND',
  });
  const token = createMockInvite(mockPicks.get('invite-pick')!);
  await expect(api.acceptInvite(token)).rejects.toMatchObject({ code: 'INVITE_NOT_FOUND' });
  expect(inPick('invite-pick')).toBe(false);
  await expect(api.setLobbyLocked('invite-pick', false)).rejects.toMatchObject({ status: 403 });
});

test('after blocking a host I cannot join their Pick; unblocking undoes it', async () => {
  const host = mockPicks.get('invite-pick')!.hostId;
  await api.blockUser(host);
  await expect(api.joinPick(MOCK_INVITE_CODE)).rejects.toMatchObject({
    code: 'JOIN_CODE_NOT_FOUND',
  });
  await api.unblockUser(host);
  await expect(api.joinPick(MOCK_INVITE_CODE)).resolves.toEqual({ pickId: 'invite-pick' });
  await expect(api.blockUser(MOCK_USER_ID)).rejects.toMatchObject({ status: 400 });
});

test('reports need a reason', async () => {
  await expect(api.report({ kind: 'user', targetId: 'mock-ava', reason: 'Spam' })).resolves.toEqual(
    {
      status: 'ok',
    },
  );
  await expect(
    api.report({ kind: 'user', targetId: 'mock-ava', reason: ' ' }),
  ).rejects.toMatchObject({
    status: 400,
  });
});
