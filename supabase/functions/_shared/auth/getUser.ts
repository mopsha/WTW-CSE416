// Verifies a caller's Supabase access token and returns their user id.
// Pure TS: no Deno, supabase-js or React Native imports, so it runs in the Edge
// Function, Jest and the app's lint/typecheck. The API reads env and wires it up:
//
//   // supabase/functions/api/auth.ts
//   const verify = createGetUser({
//     supabaseUrl: Deno.env.get('SUPABASE_URL') ?? '',
//     apiKey: Deno.env.get('SUPABASE_ANON_KEY') ?? '',
//   });
//   export async function getUser(req: Request) {
//     try {
//       return await verify(req);
//     } catch (e) {
//       if (e instanceof AuthError) throw new ApiError(e.status, e.code, e.message);
//       throw e;
//     }
//   }
//
// The token is checked by Supabase Auth (GET /auth/v1/user), never merely decoded,
// so signed-out and deleted users are rejected too.

export interface AuthUser {
  id: string;
}

export interface GetUserConfig {
  /** e.g. SUPABASE_URL inside the Edge Function. */
  supabaseUrl: string;
  /** A key Auth accepts as `apikey` (the anon/publishable key is enough). */
  apiKey: string;
  /** Injected for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
}

/** Missing, malformed, expired or revoked token. Maps to HTTP 401. */
export class AuthError extends Error {
  readonly status = 401 as const;
  readonly code = 'UNAUTHENTICATED';
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The token from `Authorization: Bearer <token>`, or null. */
export function bearerToken(req: Request): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.get('Authorization') ?? '');
  return match?.[1] ?? null;
}

export function createGetUser(config: GetUserConfig): (req: Request) => Promise<AuthUser> {
  const doFetch = config.fetch ?? fetch;
  const url = `${config.supabaseUrl.replace(/\/+$/, '')}/auth/v1/user`;

  return async function getUser(req) {
    if (!config.supabaseUrl || !config.apiKey) {
      throw new Error('getUser is not configured');
    }
    const token = bearerToken(req);
    if (!token) throw new AuthError('A Bearer access token is required');

    const res = await doFetch(url, {
      headers: { apikey: config.apiKey, Authorization: `Bearer ${token}` },
    });
    if (res.status === 401 || res.status === 403) {
      throw new AuthError('Invalid or expired access token');
    }
    if (!res.ok) throw new Error(`Supabase Auth returned ${res.status}`);

    const body = (await res.json()) as { id?: unknown };
    if (typeof body.id !== 'string' || !UUID.test(body.id)) {
      throw new AuthError('Invalid or expired access token');
    }
    return { id: body.id };
  };
}
