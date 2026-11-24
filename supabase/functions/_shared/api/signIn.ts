// Smooth sign-in (owner: Alan). Spec: docs/sign-in.md.
// - GET /usernames/available?username=…: live check while choosing a username. It counts
//   against the same lookup quota as people search (30 a minute).
// - POST /auth/password-login { identifier, password }: log in with a username (or email) and
//   password. The server finds a username's account and never reveals its email. A wrong
//   password and an unknown username fail the same way and take about as long. Every request
//   reaches Supabase from the server's address, so the API limits attempts itself:
//     per account + client (a stranger can't lock you out), per client across all accounts
//     (no spraying one password over many usernames), and a global backstop.
//   Failures that aren't a wrong password (Supabase down, network) are refunded, except
//   Supabase's own rate limit: refunding that would let a flood retry for free.

import { ApiError } from './errors.ts';
import { normalizeUsername } from './usernames.ts';

export interface SignInStore {
  /** Who holds this (lowercase) username, if anyone. */
  usernameOwner(username: string): Promise<string | null>;
  /**
   * The account email for a username; null only when there's no such user. A failed lookup
   * throws (503) instead, so an outage never looks like a wrong username.
   */
  emailForUsername(username: string): Promise<string | null>;
  /**
   * Counts one attempt against every subject, or none if any is over its limit. Returns the
   * charge (to refund exactly that attempt), or null when refused.
   */
  consumeLoginAttempt(subjects: readonly { key: string; limit: number }[]): Promise<string | null>;
  /** Gives back the attempt `consumeLoginAttempt` charged as `charge`, at most once. */
  refundLoginAttempt(charge: string): Promise<void>;
  /**
   * Supabase password sign-in: tokens, or null for wrong credentials only. Anything else
   * (rate limit, outage, unconfirmed email) throws an ApiError with an honest message.
   * `client` is the caller's address for Supabase's own per-IP limit, or null when unknown.
   */
  passwordSignIn(
    email: string,
    password: string,
    client: string | null,
  ): Promise<SignInTokens | null>;
  /** One username lookup against the caller's quota; throws 429 when over. */
  consumeUsernameLookup(userId: string): Promise<void>;
}

export interface SignInTokens {
  accessToken: string;
  refreshToken: string;
}

/** Attempts per 15 minutes. */
export const LOGIN_LIMITS = { accountPerClient: 10, client: 20, global: 600 } as const;

const WRONG = 'Wrong username or password.';
export const TOO_MANY_TRIES = 'Too many tries. Wait a few minutes and try again.';
const UNKNOWN_CLIENT = 'unknown';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Never a real account: unknown usernames still make a real sign-in call, for equal timing. */
const NOBODY = 'nobody@invalid.getwtw.app';

/**
 * A username suggestion from a display name: lowercase letters, digits and underscores,
 * starting with a letter, 3–20 characters ("Alan John" → "alanjohn"). Null if nothing usable.
 */
export function suggestUsername(name: string): string | null {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '')
    .replace(/^[^a-z]+/, '')
    .slice(0, 20);
  return base.length >= 3 ? base : null;
}

/**
 * Whether a username can be claimed by `userId` (their own current one counts as available),
 * with a free alternative when it's taken. Invalid names come back as a reason, not an error,
 * so the screen can show it inline. One request is one lookup against the caller's quota.
 */
export async function usernameAvailability(
  store: SignInStore,
  userId: string,
  raw: unknown,
  random: () => number = Math.random,
): Promise<{ available: boolean; username: string | null; reason?: string; suggestion?: string }> {
  let username: string;
  try {
    username = normalizeUsername(raw);
  } catch (e) {
    return { available: false, username: null, reason: (e as Error).message };
  }
  await store.consumeUsernameLookup(userId);
  const owner = await store.usernameOwner(username);
  if (!owner || owner === userId) return { available: true, username };
  // Up to five tries at name + two or three digits, like "alanjohn27".
  for (let i = 0; i < 5; i++) {
    const digits = String(Math.floor(random() * (i < 3 ? 90 : 900)) + (i < 3 ? 10 : 100));
    const candidate = `${username.slice(0, 24 - digits.length)}${digits}`;
    const taken = await store.usernameOwner(candidate);
    if (!taken || taken === userId) return { available: false, username, suggestion: candidate };
  }
  return { available: false, username };
}

/** POST /auth/password-login. `client` identifies the caller (their IP) for the limits. */
export async function passwordLogin(
  store: SignInStore,
  body: unknown,
  client: string,
): Promise<SignInTokens> {
  const b =
    typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const identifier = typeof b.identifier === 'string' ? b.identifier.trim().toLowerCase() : '';
  const password = typeof b.password === 'string' ? b.password : '';
  if (!identifier || !password || password.length > 128 || identifier.length > 254)
    throw new ApiError(400, 'INVALID_INPUT', 'Enter your username and password');

  let email: string | null;
  if (EMAIL_RE.test(identifier)) {
    email = identifier;
  } else {
    let username: string | null = null;
    try {
      username = normalizeUsername(identifier, true);
    } catch {
      /* Not a possible username: fails like an unknown one, below. */
    }
    email = username ? await store.emailForUsername(username) : null;
  }

  // The account named (unknown names keyed by what was typed), per client, and overall.
  const from = network(client);
  const account = `acct:${email ?? `username:${identifier}`}|client:${from}`;
  const subjects = [
    { key: account, limit: LOGIN_LIMITS.accountPerClient },
    { key: `client:${from}`, limit: LOGIN_LIMITS.client },
    { key: 'global', limit: LOGIN_LIMITS.global },
  ];
  const charge = await store.consumeLoginAttempt(subjects);
  if (charge === null) throw new ApiError(429, 'RATE_LIMITED', TOO_MANY_TRIES);

  let tokens: SignInTokens | null;
  try {
    tokens = await store.passwordSignIn(
      email ?? NOBODY,
      password,
      client === UNKNOWN_CLIENT ? null : client,
    );
  } catch (e) {
    // Not the user's fault: don't spend their tries on it. A 429 from Supabase stays charged.
    if (!(e instanceof ApiError && e.status === 429))
      await store.refundLoginAttempt(charge).catch(() => {});
    throw e;
  }
  if (!tokens || !email) throw new ApiError(401, 'INVALID_LOGIN', WRONG);
  return tokens;
}

const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?!$)|$)){4}$/;

/** An IPv4 or IPv6 address in its one canonical spelling, or null if it isn't one. */
function normalizeAddress(raw: string): string | null {
  if (IPV4_RE.test(raw)) return raw;
  if (!raw.includes(':') || !/^[0-9a-f:.]+$/i.test(raw)) return null;
  let v6: string;
  try {
    v6 = new URL(`http://[${raw}]`).hostname.slice(1, -1);
  } catch {
    return null;
  }
  // ::ffff:a.b.c.d is that IPv4 address.
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v6);
  if (!mapped) return v6;
  const [hi, lo] = [parseInt(mapped[1]!, 16), parseInt(mapped[2]!, 16)];
  return [hi >> 8, hi & 255, lo >> 8, lo & 255].join('.');
}

/** What the limits count: a whole IPv6 /64, since one caller usually has all of its addresses. */
function network(client: string): string {
  if (!client.includes(':')) return client;
  const [head = [], tail = []] = client
    .split('::')
    .map((part) => part.split(':').filter((group) => group !== ''));
  const zeros = Array<string>(8 - head.length - tail.length).fill('0');
  return `${[...head, ...zeros, ...tail].slice(0, 4).join(':')}::/64`;
}

/**
 * The caller's address, as the platform's edge reports it. Other forwarding headers can be set
 * by the caller, so without a valid address here everyone shares a single client limit.
 */
export function clientAddress(headers: { get(name: string): string | null }): string {
  return normalizeAddress(headers.get('cf-connecting-ip')?.trim() ?? '') ?? UNKNOWN_CLIENT;
}
