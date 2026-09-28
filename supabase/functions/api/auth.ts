import { ApiError } from '../_shared/api/errors.ts';
import { createServiceClient } from './serviceClient.ts';

// TODO(Razin): replace this adapter with the shared getUser(req) when it lands.
// No existing auth helper is present. Validate with Auth; never merely decode a JWT.
export async function getUser(req: Request): Promise<{ id: string }> {
  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.get('Authorization') ?? '');
  if (!match) throw new ApiError(401, 'UNAUTHENTICATED', 'A Bearer access token is required');
  const { data, error } = await createServiceClient().auth.getUser(match[1]);
  if (error || !data.user)
    throw new ApiError(401, 'UNAUTHENTICATED', 'Invalid or expired access token');
  return { id: data.user.id };
}
