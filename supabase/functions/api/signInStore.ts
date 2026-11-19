import { createClient } from '@supabase/supabase-js';
import { ApiError } from '../_shared/api/errors.ts';
import type { SignInStore } from '../_shared/api/signIn.ts';
import { createServiceClient } from './serviceClient.ts';

/** Service-role adapter for _shared/api/signIn.ts (0052_password_login_limit.sql). */
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
      if (error) return null;
      return data.user?.email ?? null;
    },
    async consumeLoginAttempt(subject) {
      const { data, error } = await createServiceClient().rpc('consume_login_limit', {
        p_subject: subject,
      });
      if (error) throw new ApiError(503, 'DATABASE_NOT_READY', 'Sign-in is unavailable');
      return data === true;
    },
    async passwordSignIn(email, password) {
      const url = Deno.env.get('SUPABASE_URL');
      const anon = Deno.env.get('SUPABASE_ANON_KEY');
      if (!url || !anon)
        throw new ApiError(503, 'SERVER_NOT_CONFIGURED', 'Backend environment is not configured');
      // A throwaway client: the session goes back to the app, never stays on the server.
      const client = createClient(url, anon, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error || !data.session) return null;
      return {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
      };
    },
  };
}
