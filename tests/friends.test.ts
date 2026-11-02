import { errorResponse } from '@shared/api/errors.ts';
import {
  acceptFriend,
  groupFriends,
  parseFriendId,
  parseFriendRequest,
  removeFriend,
  requestFriend,
  type FriendRow,
  type FriendsStore,
} from '@shared/api/friends.ts';

const BO = '72222222-2222-4222-8222-222222222222';

const row = (over: Partial<FriendRow>): FriendRow => ({
  userId: 'x',
  displayName: null,
  status: 'pending',
  direction: 'in',
  createdAt: '2026-10-01T00:00:00Z',
  acceptedAt: null,
  ...over,
});

function store(over: Partial<FriendsStore> = {}): FriendsStore {
  const unexpected = () => {
    throw new Error('Unexpected store call');
  };
  return {
    list: unexpected,
    request: unexpected,
    accept: unexpected,
    remove: unexpected,
    takeFriendRequestLimit: unexpected,
    ...over,
  };
}

describe('parseFriendRequest', () => {
  test('trims and lowercases the email', () => {
    expect(parseFriendRequest({ email: '  Bo@Example.COM ' })).toBe('bo@example.com');
  });

  test.each([null, [], 'bo@example.com', {}, { email: 42 }, { email: 'bo' }, { email: 'a b@c.d' }])(
    'rejects %p with 400 INVALID_INPUT',
    (body) => {
      const { status, body: out } = errorResponse(captured(() => parseFriendRequest(body)));
      expect(status).toBe(400);
      expect(out.error.code).toBe('INVALID_INPUT');
    },
  );

  test('rejects absurdly long input', () => {
    const email = `${'a'.repeat(250)}@b.co`;
    expect(errorResponse(captured(() => parseFriendRequest({ email }))).status).toBe(400);
  });
});

describe('parseFriendId', () => {
  test('accepts a uuid in any case', () => {
    expect(parseFriendId(BO.toUpperCase())).toBe(BO);
  });
  test('rejects anything else', () => {
    expect(errorResponse(captured(() => parseFriendId('mock-friend'))).status).toBe(400);
  });
});

describe('groupFriends', () => {
  test('splits friends and incoming, newest first, and never lists requests I sent', () => {
    const list = groupFriends([
      row({ userId: 'old-friend', status: 'accepted', acceptedAt: '2026-10-02T00:00:00Z' }),
      row({ userId: 'new-friend', status: 'accepted', acceptedAt: '2026-10-05T00:00:00Z' }),
      row({ userId: 'asked-me', direction: 'in', createdAt: '2026-10-03T00:00:00Z' }),
      row({ userId: 'i-asked', direction: 'out', createdAt: '2026-10-04T00:00:00Z' }),
    ]);
    expect(list.friends.map((p) => p.userId)).toEqual(['new-friend', 'old-friend']);
    expect(list.incoming).toEqual([
      { userId: 'asked-me', displayName: null, since: '2026-10-03T00:00:00Z' },
    ]);
    expect(JSON.stringify(list)).not.toContain('i-asked');
  });

  test('an empty list has two empty groups', () => {
    expect(groupFriends([])).toEqual({ friends: [], incoming: [] });
  });
});

describe('handlers', () => {
  test('validate before touching the store', async () => {
    await expect(requestFriend(store(), 'me', { email: 'nope' })).rejects.toMatchObject({
      status: 400,
    });
    await expect(acceptFriend(store(), 'me', 'nope')).rejects.toMatchObject({ status: 400 });
    await expect(removeFriend(store(), 'me', 'nope')).rejects.toMatchObject({ status: 400 });
  });

  test('pass the caller and normalized input through', async () => {
    const calls: unknown[] = [];
    const s = store({
      request: async (...args) => {
        calls.push(['request', ...args]);
        return { userId: BO, displayName: 'Bo', status: 'pending' };
      },
      accept: async (...args) => {
        calls.push(['accept', ...args]);
      },
      remove: async (...args) => {
        calls.push(['remove', ...args]);
      },
    });
    await expect(requestFriend(s, 'me', { email: 'Bo@Example.com' })).resolves.toEqual({
      userId: BO,
      displayName: 'Bo',
      status: 'pending',
    });
    await expect(acceptFriend(s, 'me', BO)).resolves.toEqual({ status: 'accepted' });
    await expect(removeFriend(s, 'me', BO)).resolves.toEqual({ status: 'ok' });
    expect(calls).toEqual([
      ['request', 'me', 'bo@example.com'],
      ['accept', 'me', BO],
      ['remove', 'me', BO],
    ]);
  });
});

function captured(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error('Expected a throw');
}
