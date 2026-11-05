import { USE_MOCK } from './config';
import { mockAuth } from './mock/auth';
import { AuthError, type AuthService, type AuthSession } from './authTypes';
import { getSupabase } from './supabase';

export * from './authTypes';

type SupabaseSession = {
  access_token: string;
  user: { id: string; email?: string | null };
} | null;

function toSession(s: SupabaseSession): AuthSession | null {
  return s
    ? { accessToken: s.access_token, user: { id: s.user.id, email: s.user.email ?? null } }
    : null;
}

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
  async signInWithPassword(email, password) {
    const { data, error } = await getSupabase().auth.signInWithPassword({ email, password });
    if (error?.code === 'invalid_credentials') {
      throw new AuthError('invalid_code', 'That password is wrong.');
    }
    if (error) throw toAuthError(error);
    const session = toSession(data.session);
    if (!session) throw new AuthError('unknown', 'Sign-in did not return a session.');
    return session;
  },
  async signOut() {
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
