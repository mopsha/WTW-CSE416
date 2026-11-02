import { ApiError, errorResponse } from '@shared/api/errors.ts';
import {
  FRIEND_REQUEST_SENT,
  requestFriendSafely,
  type FriendRequestStore,
} from '@shared/api/friendRequests.ts';
import { createInvite, parseCreateInvite } from '@shared/api/invites.ts';
import { blockUser, parseReport } from '@shared/api/safety.ts';
import { inviteUrl, parseInviteToken } from '@shared/domain/inviteLink.ts';

const OTHER = '00000000-0000-4000-8000-000000000002';
const status = (e: unknown) => errorResponse(e).status;

describe('requestFriendSafely (#24 calls this)', () => {
  const storeWith = (request: FriendRequestStore['request'], allowed = true) => {
    const calls: string[] = [];
    const store: FriendRequestStore = {
      takeFriendRequestLimit: async (u) => {
        calls.push(`limit ${u}`);
        return allowed;
      },
      request: async (u, e) => {
        calls.push(`request ${u} ${e}`);
        return request(u, e);
      },
    };
    return { store, calls };
  };

  test('the same answer whether or not the email has an account', async () => {
    const found = storeWith(async () => ({ userId: 'x', displayName: 'Ben', status: 'pending' }));
    const missing = storeWith(async () => {
      throw new ApiError(404, 'USER_NOT_FOUND', 'No WTW account uses that email');
    });
    const a = await requestFriendSafely(found.store, 'me', { email: ' ben@example.com ' });
    const b = await requestFriendSafely(missing.store, 'me', { email: 'nobody@example.com' });
    expect(a).toEqual(FRIEND_REQUEST_SENT);
    expect(b).toEqual(a);
    expect(JSON.stringify(a)).not.toContain('Ben');
    expect(found.calls).toEqual(['limit me', 'request me ben@example.com']);
  });

  test('over the daily limit is 429, before any lookup', async () => {
    const { store, calls } = storeWith(async () => ({}), false);
    const error = await requestFriendSafely(store, 'me', { email: 'a@b.co' }).catch(
      (e: unknown) => e,
    );
    expect(status(error)).toBe(429);
    expect(calls).toEqual(['limit me']);
  });

  test('a bad email is 400 and uses no limit; other errors pass through', async () => {
    const { store, calls } = storeWith(async () => {
      throw new ApiError(400, 'CANNOT_FRIEND_SELF', 'You cannot add yourself');
    });
    expect(
      status(await requestFriendSafely(store, 'me', { email: 'nope' }).catch((e: unknown) => e)),
    ).toBe(400);
    expect(calls).toEqual([]);
    const self = await requestFriendSafely(store, 'me', { email: 'me@x.co' }).catch(
      (e: unknown) => e,
    );
    expect(errorResponse(self).body.error.code).toBe('CANNOT_FRIEND_SELF');
  });
});

describe('reports and blocks', () => {
  test('parseReport trims and checks every field', () => {
    expect(parseReport({ kind: 'group', targetId: OTHER.toUpperCase(), reason: ' spam ' })).toEqual(
      {
        kind: 'group',
        targetId: OTHER,
        reason: 'spam',
      },
    );
    for (const bad of [
      null,
      [],
      {},
      { kind: 'user', targetId: OTHER, reason: '' },
      { kind: 'x', targetId: OTHER, reason: 'r' },
    ]) {
      expect(() => parseReport(bad)).toThrow(ApiError);
    }
  });

  test('blocking yourself is 400 before the store', async () => {
    const block = jest.fn();
    const store = { block, unblock: jest.fn(), report: jest.fn(), setLobbyLocked: jest.fn() };
    expect(status(await blockUser(store, OTHER, OTHER).catch((e: unknown) => e))).toBe(400);
    expect(block).not.toHaveBeenCalled();
  });
});

describe('invite links', () => {
  test('tokens are 22 base64url characters', () => {
    expect(parseInviteToken('AbCdEfGhIjKlMnOpQrStU_')).toBe('AbCdEfGhIjKlMnOpQrStU_');
    expect(parseInviteToken(' AbCdEfGhIjKlMnOpQrSt-_ ')).toBe('AbCdEfGhIjKlMnOpQrSt-_');
    for (const bad of [
      '',
      'short',
      'AbCdEfGhIjKlMnOpQrStU+',
      'AbCdEfGhIjKlMnOpQrStU_x',
      '../../../etc/passwd!!',
    ]) {
      expect(parseInviteToken(bad)).toBeNull();
    }
    expect(inviteUrl('AbCdEfGhIjKlMnOpQrStU_')).toBe('wtw://i/AbCdEfGhIjKlMnOpQrStU_');
  });

  test('parseCreateInvite defaults maxUses to null and bounds it', () => {
    expect(parseCreateInvite({ kind: 'pick', targetId: OTHER })).toEqual({
      kind: 'pick',
      targetId: OTHER,
      maxUses: null,
    });
    expect(parseCreateInvite({ kind: 'group', targetId: OTHER, maxUses: 100 }).maxUses).toBe(100);
    for (const maxUses of [0, 101, 2.5, '5']) {
      expect(() => parseCreateInvite({ kind: 'pick', targetId: OTHER, maxUses })).toThrow(ApiError);
    }
  });

  test('createInvite adds the deep link', async () => {
    const link = await createInvite(
      {
        create: async (_u, i) => ({
          token: 'AbCdEfGhIjKlMnOpQrStU_',
          kind: i.kind,
          targetId: i.targetId,
          expiresAt: 'x',
          maxUses: null,
        }),
        accept: jest.fn(),
        revoke: jest.fn(),
      },
      'me',
      { kind: 'pick', targetId: OTHER },
    );
    expect(link.url).toBe('wtw://i/AbCdEfGhIjKlMnOpQrStU_');
  });
});
