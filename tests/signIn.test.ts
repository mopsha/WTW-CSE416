import {
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
    consumeLoginAttempt: jest.fn(async () => true),
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

describe('usernameAvailability', () => {
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
    const result = await passwordLogin(s, { identifier: ' Alan ', password: 'pw-123456' });
    expect(result).toEqual(tokens);
    expect(JSON.stringify(result)).not.toContain('@');
    expect(s.emailForUsername).toHaveBeenCalledWith('alan');
    expect(s.passwordSignIn).toHaveBeenCalledWith('alan@example.com', 'pw-123456');
  });

  test('an email signs in directly', async () => {
    const s = store({ passwordSignIn: jest.fn(async () => tokens) });
    await passwordLogin(s, { identifier: 'Alan@Example.com', password: 'x' });
    expect(s.emailForUsername).not.toHaveBeenCalled();
    expect(s.passwordSignIn).toHaveBeenCalledWith('alan@example.com', 'x');
  });

  test('unknown user and wrong password fail the same way', async () => {
    const unknown = passwordLogin(store(), { identifier: 'nobody', password: 'x' });
    const wrong = passwordLogin(store({ emailForUsername: jest.fn(async () => 'a@b.co') }), {
      identifier: 'alan',
      password: 'x',
    });
    for (const attempt of [unknown, wrong])
      await expect(attempt).rejects.toMatchObject({
        status: 401,
        message: 'Wrong username or password.',
      });
  });

  test('each account has an attempt limit, unknown names included', async () => {
    const s = store({ consumeLoginAttempt: jest.fn(async () => false) });
    await expect(passwordLogin(s, { identifier: 'ghost', password: 'x' })).rejects.toMatchObject({
      status: 429,
    });
    expect(s.consumeLoginAttempt).toHaveBeenCalledWith('username:ghost');
    expect(s.passwordSignIn).not.toHaveBeenCalled();
  });

  test('missing or oversized input is a 400', async () => {
    for (const body of [
      null,
      {},
      { identifier: 'a' },
      { identifier: 'a', password: 'x'.repeat(129) },
    ])
      await expect(passwordLogin(store(), body)).rejects.toMatchObject({ status: 400 });
  });
});
