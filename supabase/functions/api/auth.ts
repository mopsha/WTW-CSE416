import { ApiError } from '../_shared/api/errors.ts';
import { AuthError, createGetUser } from '../_shared/auth/getUser.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const apiKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
// Razin's shared helper: Supabase Auth validates the token; it is never merely decoded.
const verify = createGetUser({ supabaseUrl, apiKey });

export async function getUser(req: Request): Promise<{ id: string }> {
  if (!supabaseUrl || !apiKey) {
    throw new ApiError(503, 'SERVER_NOT_CONFIGURED', 'Backend environment is not configured');
  }
  try {
    return await verify(req);
  } catch (e) {
    if (e instanceof AuthError) throw new ApiError(e.status, e.code, e.message);
    throw e;
  }
}
