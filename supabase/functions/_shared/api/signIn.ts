// Smooth sign-in (owner: Alan). Spec: docs/sign-in.md.
// - GET /usernames/available?username=…: live check while choosing a username.
// - POST /auth/password-login { identifier, password }: log in with a username (or email) and
//   password. Emails can sign in directly from the app; usernames need the server to find the
//   account's email, which it never reveals. Every failure is the same "wrong username or
//   password", and each account has its own attempt limit, since these sign-ins all come from
//   the server's address and Supabase's per-address limits can't tell users apart.

import { ApiError } from './errors.ts';
import { normalizeUsername } from './usernames.ts';

export interface SignInStore {
  /** Who holds this (lowercase) username, if anyone. */
  usernameOwner(username: string): Promise<string | null>;
  /** The account email for a username; null when there's no such user. */
  emailForUsername(username: string): Promise<string | null>;
  /** Counts one attempt for this account; false once over the limit. */
  consumeLoginAttempt(subject: string): Promise<boolean>;
  /** Supabase password sign-in; null for wrong credentials. */
  passwordSignIn(email: string, password: string): Promise<SignInTokens | null>;
}

export interface SignInTokens {
  accessToken: string;
  refreshToken: string;
}

const WRONG = 'Wrong username or password.';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
 * so the screen can show it inline.
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

/** POST /auth/password-login. Throws one generic 401 for every kind of failure. */
export async function passwordLogin(store: SignInStore, body: unknown): Promise<SignInTokens> {
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
    let username: string;
    try {
      username = normalizeUsername(identifier, true);
    } catch {
      throw new ApiError(401, 'INVALID_LOGIN', WRONG);
    }
    email = await store.emailForUsername(username);
  }
  // Limit per account named (unknown names too, so probing them is limited the same way).
  if (!(await store.consumeLoginAttempt(email ?? `username:${identifier}`)))
    throw new ApiError(429, 'RATE_LIMITED', 'Too many tries. Wait a few minutes and try again.');
  const tokens = email ? await store.passwordSignIn(email, password) : null;
  if (!tokens) throw new ApiError(401, 'INVALID_LOGIN', WRONG);
  return tokens;
}
