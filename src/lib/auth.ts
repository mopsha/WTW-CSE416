import { clearPendingProfile } from './pendingProfile';
import { API_BASE_URL, SUPABASE_ANON_KEY, SUPABASE_URL, USE_MOCK } from './config';
import { mockAuth } from './mock/auth';
import { accountChanged, AuthError, type AuthService, type AuthSession } from './authTypes';
import { appleIdToken, googleIdToken } from './socialSignIn';
import { getSupabase } from './supabase';

export * from './authTypes';

type SupabaseSession = {
  access_token: string;
  user: {
    id: string;
    email?: string | null;
    app_metadata?: { provider?: string };
    user_metadata?: { full_name?: string; name?: string };
  };
} | null;

function toSession(s: SupabaseSession): AuthSession | null {
  if (!s) return null;
  const meta = s.user.user_metadata;
  return {
    accessToken: s.access_token,
    user: {
      id: s.user.id,
      email: s.user.email ?? null,
      provider: s.user.app_metadata?.provider,
      name: meta?.full_name ?? meta?.name ?? null,
    },
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toAuthError(error: { code?: string; status?: number; message: string }): AuthError {
  if (error.code === 'otp_expired' || error.status === 403) {
    return new AuthError('invalid_code', 'That code is wrong or has expired.');
  }
  if (error.status === 429 || error.code?.startsWith('over_')) {
    return new AuthError('rate_limited', 'Too many attempts. Wait a minute and try again.');
  }
  if (error.code === 'validation_failed' || error.code === 'email_address_invalid') {
    return new AuthError('invalid_email', 'That email address doesn’t look right.');
  }
  return new AuthError('unknown', error.message);
}

/**
 * A password change only applies to the account the screen was opened for. The account check
 * and the request use one session snapshot: the request carries that session's own token, so
 * Supabase applies it to that user even if another account signs in meanwhile. (The SDK's
 * updateUser/reauthenticate re-read the session inside their own lock, after any check of ours.)
 */
async function asAccount(
  userId: string,
  method: 'PUT' | 'GET',
  path: '/user' | '/reauthenticate',
  body?: object,
): Promise<{ code?: string; status: number; message: string } | null> {
  const { data } = await getSupabase().auth.getSession();
  const session = data.session;
  if (!session || session.user.id !== userId) throw accountChanged();
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/auth/v1${path}`, {
      method,
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new AuthError('unknown', 'Can’t reach sign-in. Check your connection and try again.');
  }
  if (res.ok) return null;
  const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const code = [err.error_code, err.code].find((c): c is string => typeof c === 'string');
  const message = [err.msg, err.message, err.error_description].find(
    (m): m is string => typeof m === 'string',
  );
  return { code, status: res.status, message: message ?? `Something went wrong (${res.status}).` };
}

const supabaseAuth: AuthService = {
  async getSession() {
    const { data } = await getSupabase().auth.getSession();
    return toSession(data.session);
  },
  onChange(listener) {
    const { data } = getSupabase().auth.onAuthStateChange((_event, session) => {
      listener(toSession(session));
    });
    return () => data.subscription.unsubscribe();
  },
  async sendCode(email, mode = 'login') {
    const { error } = await getSupabase().auth.signInWithOtp({
      email,
      options: { shouldCreateUser: mode === 'signup' },
    });
    if (error?.code === 'signup_disabled' && mode === 'login') {
      throw new AuthError(
        'unknown',
        'Could not send a login code. Check your email or choose Sign Up.',
      );
    }
    if (error) throw toAuthError(error);
  },
  async verifyCode(email, code) {
    const { data, error } = await getSupabase().auth.verifyOtp({
      email,
      token: code,
      type: 'email',
    });
    if (error) throw toAuthError(error);
    const session = toSession(data.session);
    if (!session) throw new AuthError('unknown', 'Sign-in did not return a session.');
    return session;
  },
  async signInWithPassword(identifier, password) {
    const id = identifier.trim().toLowerCase();
    if (EMAIL_RE.test(id)) {
      const { data, error } = await getSupabase().auth.signInWithPassword({ email: id, password });
      if (error?.code === 'invalid_credentials')
        throw new AuthError('invalid_code', 'Wrong username or password.');
      if (error) throw toAuthError(error);
      const session = toSession(data.session);
      if (!session) throw new AuthError('unknown', 'Sign-in did not return a session.');
      return session;
    }
    // A username: the server finds the account (never revealing its email) and signs in.
    let res: Response;
    try {
      res = await fetch(`${API_BASE_URL}/auth/password-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
        body: JSON.stringify({ identifier: id, password }),
      });
    } catch {
      throw new AuthError('unknown', 'Couldn’t reach WTW. Check your connection and try again.');
    }
    if (res.status === 429)
      throw new AuthError('rate_limited', 'Too many tries. Wait a few minutes and try again.');
    if (res.status === 401) throw new AuthError('invalid_code', 'Wrong username or password.');
    if (!res.ok) {
      // Outages and unconfirmed emails say so, instead of blaming the password.
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      throw new AuthError(
        'unknown',
        body?.error?.message ?? 'Sign-in is busy right now. Try again in a minute.',
      );
    }
    const tokens = (await res.json()) as { accessToken: string; refreshToken: string };
    const { data, error } = await getSupabase().auth.setSession({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
    });
    if (error) throw toAuthError(error);
    const session = toSession(data.session);
    if (!session) throw new AuthError('unknown', 'Sign-in did not return a session.');
    return session;
  },
  async setPassword(password, { userId, code }) {
    const error = await asAccount(userId, 'PUT', '/user', {
      password,
      ...(code ? { nonce: code } : {}),
    });
    if (error?.code === 'reauthentication_needed')
      throw new AuthError('reauth_needed', 'We emailed you a code to confirm this change.');
    if (error?.code === 'reauthentication_not_valid')
      throw new AuthError('invalid_code', 'That code is wrong or has expired.');
    if (error?.code === 'same_password')
      throw new AuthError('unknown', 'That’s already your password.');
    if (error?.code === 'weak_password')
      throw new AuthError('unknown', 'Pick a stronger password (at least 8 characters).');
    if (error) throw toAuthError(error);
  },
  async requestPasswordCode(userId) {
    const error = await asAccount(userId, 'GET', '/reauthenticate');
    if (error) throw toAuthError(error);
  },
  async signInWithApple() {
    const result = await appleIdToken();
    if (!result) return null;
    const { data, error } = await getSupabase().auth.signInWithIdToken({
      provider: 'apple',
      token: result.token,
    });
    if (error) throw toAuthError(error);
    // Apple only shares the name on the very first sign-in, and not in its token: keep it.
    if (result.name) await getSupabase().auth.updateUser({ data: { full_name: result.name } });
    const session = toSession(data.session);
    if (!session) throw new AuthError('unknown', 'Sign-in did not return a session.');
    return result.name ? { ...session, user: { ...session.user, name: result.name } } : session;
  },
  async signInWithGoogle() {
    const token = await googleIdToken();
    if (!token) return null;
    const { data, error } = await getSupabase().auth.signInWithIdToken({
      provider: 'google',
      token,
    });
    if (error) throw toAuthError(error);
    const session = toSession(data.session);
    if (!session) throw new AuthError('unknown', 'Sign-in did not return a session.');
    return session;
  },
  async signOut() {
    await clearPendingProfile();
    const { error } = await getSupabase().auth.signOut();
    if (error) throw new AuthError('unknown', 'Could not sign out. Please try again.');
  },
};

export const auth: AuthService = USE_MOCK ? mockAuth : supabaseAuth;

export async function getAccessToken(): Promise<string | null> {
  return (await auth.getSession())?.accessToken ?? null;
}

/** Explicit, single retry for protected photo requests; existing auth flows are unchanged. */
export async function refreshPhotoSession(): Promise<AuthSession | null> {
  if (USE_MOCK) return mockAuth.getSession();
  const { data, error } = await getSupabase().auth.refreshSession();
  if (error) return null;
  return toSession(data.session);
}
