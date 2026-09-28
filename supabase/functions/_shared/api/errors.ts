export type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 500 | 503;

export class ApiError extends Error {
  constructor(
    public readonly status: ErrorStatus,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Never expose database errors, stack traces, or credentials to callers. */
export function errorResponse(error: unknown) {
  const safe =
    error instanceof ApiError
      ? error
      : new ApiError(500, 'INTERNAL_ERROR', 'An unexpected server error occurred');
  return { status: safe.status, body: { error: { code: safe.code, message: safe.message } } };
}

export function parseSwipe(body: unknown): { placeId: string; value: 0 | 1 | 2 } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ApiError(400, 'INVALID_INPUT', 'Expected a swipe object');
  }
  const { placeId, value } = body as Record<string, unknown>;
  if (
    typeof placeId !== 'string' ||
    !placeId.trim() ||
    placeId.length > 256 ||
    (value !== 0 && value !== 1 && value !== 2)
  ) {
    throw new ApiError(400, 'INVALID_INPUT', 'Expected placeId and value 0, 1, or 2');
  }
  return { placeId, value };
}
