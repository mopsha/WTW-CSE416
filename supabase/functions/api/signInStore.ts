import { createClient } from '@supabase/supabase-js';
import { ApiError } from '../_shared/api/errors.ts';
import { TOO_MANY_TRIES, type SignInStore } from '../_shared/api/signIn.ts';
import { createServiceClient } from './serviceClient.ts';

/**
 * The project's new-style secret key, when it has one (Supabase provides them as a JSON
 * dictionary). Supabase accepts Sb-Forwarded-For only with one of these, never a legacy key.
 */
function secretKey(): string | null {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as object;
    const key = Object.values(keys).find(
      (k) => typeof k === 'string' && k.startsWith('sb_secret_'),
    );
    return (key as string | undefined) ?? null;
  } catch {
    return null;
  }
}

/** The SDK also sends its key as a Bearer token; a secret key belongs only in `apikey`. */
const withoutBearer: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers);
  headers.delete('Authorization');
  return fetch(input, { ...init, headers });
};

/** Service-role adapter for _shared/api/signIn.ts (0057_password_login_limit.sql). */
export function createSignInStore(): SignInStore {
  async function owner(username: string): Promise<string | null> {
    // Usernames are stored lowercase (0036's trigger), so equality is exact.
    const { data, error } = await createServiceClient()
      .from('profiles')
      .select('id')
      .eq('username', username)
      .maybeSingle();
    if (error) throw new ApiError(503, 'DATABASE_NOT_READY', 'Usernames are unavailable');
    return (data as { id: string } | null)?.id ?? null;
  }
  return {
    usernameOwner: owner,
    async emailForUsername(username) {
      const id = await owner(username);
      if (!id) return null;
      const { data, error } = await createServiceClient().auth.admin.getUserById(id);
      // A profile whose account is gone is an unknown user; any other failure is an outage,
      // reported as one (and, as it happens before the limit, never charged as a try).
      if (error && error.status !== 404)
        throw new ApiError(
          503,
          'SIGN_IN_UNAVAILABLE',
          'Sign-in is busy right now. Try again in a minute.',
        );
      return data?.user?.email ?? null;
    },
    async consumeLoginAttempt(subjects) {
      const { data, error } = await createServiceClient().rpc('consume_login_limit', {
        p_subjects: subjects.map((s) => s.key),
        p_limits: subjects.map((s) => s.limit),
      });
      if (error) throw new ApiError(503, 'DATABASE_NOT_READY', 'Sign-in is unavailable');
      return typeof data === 'string' ? data : null;
    },
    async refundLoginAttempt(charge) {
      await createServiceClient().rpc('refund_login_limit', { p_reservation: charge });
    },
    async consumeUsernameLookup(userId) {
      const { error } = await createServiceClient().rpc('consume_username_lookup', {
        p_user_id: userId,
      });
      if (error?.code === 'PT429')
        throw new ApiError(429, 'RATE_LIMITED', 'Too many username checks. Try again shortly.');
      if (error) throw new ApiError(503, 'DATABASE_NOT_READY', 'Usernames are unavailable');
    },
    async passwordSignIn(email, password, clientIp) {
      const url = Deno.env.get('SUPABASE_URL');
      const anon = Deno.env.get('SUPABASE_ANON_KEY');
      if (!url || !anon)
        throw new ApiError(503, 'SERVER_NOT_CONFIGURED', 'Backend environment is not configured');
      // Forward the caller's address so Supabase's per-IP limit counts them, not this server,
      // which every username login shares. Without a secret key, that limit stays shared.
      const secret = clientIp ? secretKey() : null;
      // A throwaway client: the session goes back to the app, never stays on the server.
      const client = createClient(url, secret ?? anon, {
        auth: { persistSession: false, autoRefreshToken: false },
        ...(secret && clientIp
          ? { global: { headers: { 'sb-forwarded-for': clientIp }, fetch: withoutBearer } }
          : {}),
      });
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      // Only a real wrong-credentials answer counts as a wrong password.
      if (error?.code === 'invalid_credentials') return null;
      if (error?.status === 429) throw new ApiError(429, 'RATE_LIMITED', TOO_MANY_TRIES);
      if (error?.code === 'email_not_confirmed')
        throw new ApiError(
          403,
          'EMAIL_NOT_CONFIRMED',
          'Confirm your email first, or log in with an emailed code.',
        );
      if (error || !data.session)
        throw new ApiError(
          503,
          'SIGN_IN_UNAVAILABLE',
          'Sign-in is busy right now. Try again in a minute, or log in with an emailed code.',
        );
      return {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
      };
    },
  };
}
