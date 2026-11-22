import { ApiError } from '@shared/api/errors.ts';
import {
  clientAddress,
  LOGIN_LIMITS,
  passwordLogin,
  suggestUsername,
  usernameAvailability,
  type SignInStore,
} from '@shared/api/signIn.ts';
import { normalizeUsername } from '@shared/api/usernames.ts';

function store(overrides: Partial<SignInStore> = {}): jest.Mocked<SignInStore> {
  return {
    usernameOwner: jest.fn(async () => null),
    emailForUsername: jest.fn(async () => null),
    consumeLoginAttempt: jest.fn(async () => 'bucket-1'),
    refundLoginAttempt: jest.fn(async () => {}),
    consumeUsernameLookup: jest.fn(async () => {}),
    passwordSignIn: jest.fn(async () => null),
    ...overrides,
  } as jest.Mocked<SignInStore>;
}

test('usernames are suggested from a real name', () => {
  expect(suggestUsername('Alan John')).toBe('alanjohn');
  expect(suggestUsername('  José Núñez ')).toBe('josenunez');
  expect(suggestUsername('123 Mike')).toBe('mike');
  expect(suggestUsername('Ty')).toBeNull();
  expect(suggestUsername('😀😀')).toBeNull();
  expect(suggestUsername('A'.repeat(40))).toHaveLength(20);
});

test('new usernames must start with a letter; existing ones are kept', () => {
  expect(() => normalizeUsername('123abc')).toThrow('start with a letter');
  expect(() => normalizeUsername('_cool')).toThrow('start with a letter');
  expect(normalizeUsername('@Alan_J')).toBe('alan_j');
  // Someone who already has "1stplace" keeps it.
  expect(normalizeUsername('1stplace', false, '1stplace')).toBe('1stplace');
  // Searching never applies claim rules.
  expect(normalizeUsername('123abc', true)).toBe('123abc');
});

test('the client address comes from the edge headers', () => {
  const h = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });
  expect(clientAddress(h({ 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '9.9.9.9' }))).toBe(
    '1.1.1.1',
  );
  expect(clientAddress(h({ 'x-forwarded-for': '2.2.2.2, 10.0.0.1' }))).toBe('2.2.2.2');
  expect(clientAddress(h({}))).toBe('unknown');
});

describe('usernameAvailability', () => {
  test('each check spends one lookup from the quota, and invalid names spend none', async () => {
    const s = store();
    await usernameAvailability(s, 'me', 'fresh');
    await usernameAvailability(s, 'me', '9lives');
    expect(s.consumeUsernameLookup).toHaveBeenCalledTimes(1);
    expect(s.consumeUsernameLookup).toHaveBeenCalledWith('me');
  });
  test('free, mine, invalid, and taken with a free alternative', async () => {
    const s = store({
      usernameOwner: jest.fn(async (u: string) =>
        u === 'alan' || u === 'alan10' ? 'someone' : u === 'mine' ? 'me' : null,
      ),
    });
    expect(await usernameAvailability(s, 'me', 'Fresh')).toEqual({
      available: true,
      username: 'fresh',
    });
    expect(await usernameAvailability(s, 'me', 'mine')).toEqual({
      available: true,
      username: 'mine',
    });
    expect(await usernameAvailability(s, 'me', '9lives')).toMatchObject({
      available: false,
      reason: 'Username must start with a letter',
    });
    // random() = 0 → 10 (taken), then 0.5 → 55 (free).
    const rolls = [0, 0.5];
    expect(await usernameAvailability(s, 'me', 'alan', () => rolls.shift() ?? 0)).toEqual({
      available: false,
      username: 'alan',
      suggestion: 'alan55',
    });
  });
});

describe('passwordLogin', () => {
  const tokens = { accessToken: 'a', refreshToken: 'r' };

  test('a username signs in through its email, which never comes back', async () => {
    const s = store({
      emailForUsername: jest.fn(async () => 'alan@example.com'),
      passwordSignIn: jest.fn(async () => tokens),
    });
    const result = await passwordLogin(s, { identifier: ' Alan ', password: 'pw-123456' }, 'ip1');
    expect(result).toEqual(tokens);
    expect(JSON.stringify(result)).not.toContain('@');
    expect(s.emailForUsername).toHaveBeenCalledWith('alan');
    expect(s.passwordSignIn).toHaveBeenCalledWith('alan@example.com', 'pw-123456');
  });

  test('an email signs in directly', async () => {
    const s = store({ passwordSignIn: jest.fn(async () => tokens) });
    await passwordLogin(s, { identifier: 'Alan@Example.com', password: 'x' }, 'ip1');
    expect(s.emailForUsername).not.toHaveBeenCalled();
    expect(s.passwordSignIn).toHaveBeenCalledWith('alan@example.com', 'x');
  });

  test('unknown user and wrong password fail the same way', async () => {
    const unknown = passwordLogin(store(), { identifier: 'nobody', password: 'x' }, 'ip1');
    const wrong = passwordLogin(
      store({ emailForUsername: jest.fn(async () => 'a@b.co') }),
      { identifier: 'alan', password: 'x' },
      'ip1',
    );
    for (const attempt of [unknown, wrong])
      await expect(attempt).rejects.toMatchObject({
        status: 401,
        message: 'Wrong username or password.',
      });
  });

  test('each account has an attempt limit, unknown names included', async () => {
    const s = store({ consumeLoginAttempt: jest.fn(async () => null) });
    await expect(
      passwordLogin(s, { identifier: 'ghost', password: 'x' }, 'ip1'),
    ).rejects.toMatchObject({
      status: 429,
    });
    expect(s.consumeLoginAttempt).toHaveBeenCalledWith([
      { key: 'acct:username:ghost|client:ip1', limit: LOGIN_LIMITS.accountPerClient },
      { key: 'client:ip1', limit: LOGIN_LIMITS.client },
      { key: 'global', limit: LOGIN_LIMITS.global },
    ]);
    expect(s.passwordSignIn).not.toHaveBeenCalled();
  });

  test("a stranger's junk tries only count against their own client", async () => {
    const s = store({ emailForUsername: jest.fn(async () => 'alan@example.com') });
    await expect(
      passwordLogin(s, { identifier: 'alan', password: 'x' }, 'attacker'),
    ).rejects.toMatchObject({ status: 401 });
    const keys = (s.consumeLoginAttempt.mock.calls[0]![0] as unknown as { key: string }[]).map(
      (k) => k.key,
    );
    expect(keys).toContain('acct:alan@example.com|client:attacker');
    expect(keys).not.toContain('acct:alan@example.com');
  });

  test('unknown usernames still make a real sign-in call, so timing matches', async () => {
    const s = store();
    await expect(
      passwordLogin(s, { identifier: 'nobody', password: 'x' }, 'ip1'),
    ).rejects.toMatchObject({ status: 401 });
    expect(s.passwordSignIn).toHaveBeenCalledWith('nobody@invalid.getwtw.app', 'x');
  });

  test('an outage is reported honestly and the attempt is refunded', async () => {
    const s = store({
      emailForUsername: jest.fn(async () => 'alan@example.com'),
      passwordSignIn: jest.fn(async () => {
        throw new ApiError(503, 'SIGN_IN_UNAVAILABLE', 'Sign-in is busy right now.');
      }),
    });
    await expect(
      passwordLogin(s, { identifier: 'alan', password: 'x' }, 'ip1'),
    ).rejects.toMatchObject({ status: 503 });
    // Exactly the attempt that was charged (its one-time reservation), never another one.
    expect(s.refundLoginAttempt).toHaveBeenCalledTimes(1);
    expect(s.refundLoginAttempt).toHaveBeenCalledWith('bucket-1');
  });

  test('a failed account lookup is an outage, not a wrong password, and is never charged', async () => {
    const s = store({
      emailForUsername: jest.fn(async () => {
        throw new ApiError(503, 'SIGN_IN_UNAVAILABLE', 'Sign-in is busy right now.');
      }),
    });
    await expect(
      passwordLogin(s, { identifier: 'alan', password: 'x' }, 'ip1'),
    ).rejects.toMatchObject({ status: 503 });
    expect(s.consumeLoginAttempt).not.toHaveBeenCalled();
    expect(s.passwordSignIn).not.toHaveBeenCalled();
  });

  test('missing or oversized input is a 400', async () => {
    for (const body of [
      null,
      {},
      { identifier: 'a' },
      { identifier: 'a', password: 'x'.repeat(129) },
    ])
      await expect(passwordLogin(store(), body, 'ip1')).rejects.toMatchObject({ status: 400 });
  });
});
