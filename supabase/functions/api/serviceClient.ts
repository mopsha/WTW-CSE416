import { createClient } from '@supabase/supabase-js';
import { ApiError } from '../_shared/api/errors.ts';

/** Server only. Never import this module from app/, src/, or _shared/. */
export function createServiceClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    throw new ApiError(503, 'SERVER_NOT_CONFIGURED', 'Backend environment is not configured');
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
