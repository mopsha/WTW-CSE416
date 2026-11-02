import { ApiError } from '../_shared/api/errors.ts';

/** The PT4xx codes of 0014's RPCs as HTTP errors; anything else is a generic 500. */
export function rpcError(error: { code?: string }, notFound = 'Not found'): never {
  switch (error.code) {
    case 'PGRST202':
      throw new ApiError(503, 'DATABASE_NOT_READY', 'This feature is not installed yet');
    case 'PT400':
      throw new ApiError(400, 'INVALID_INPUT', 'That request isn’t valid');
    case 'PT403':
      throw new ApiError(403, 'FORBIDDEN', 'You can’t do that here');
    case 'PT404':
      throw new ApiError(404, 'NOT_FOUND', notFound);
    case 'PT409':
      throw new ApiError(409, 'PICK_CLOSED', 'This Pick is no longer accepting people');
    case 'PT429':
      throw new ApiError(429, 'RATE_LIMITED', 'You’ve done that a lot today. Try again tomorrow.');
    default:
      throw new Error('Database operation failed');
  }
}
