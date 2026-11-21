const FALLBACK = 'Something went wrong. Please try again.';

// Server codes whose messages are written for developers ("deadlineAt must…", "Pick must be
// draft to start"). Everything else the server sends is already written for people.
const FRIENDLY: Record<string, string> = {
  INVALID_PICK_STATE: 'This Pick has already moved on. Go back and open it again.',
  NOT_ENOUGH_PARTICIPANTS: 'You need at least one friend in the Pick to start.',
  RATE_LIMITED: 'You’re doing that a lot. Try again in a few minutes.',
  NOT_CONFIGURED: 'That isn’t available right now. Try again later.',
  SERVER_NOT_CONFIGURED: 'That isn’t available right now. Try again later.',
  DATABASE_NOT_READY: 'That isn’t available right now. Try again later.',
  INTERNAL_ERROR: 'WTW hit a snag. Try again in a moment.',
  PLACES_UNAVAILABLE: 'Couldn’t load places right now. Try again in a minute.',
};

/** A message that is safe and useful to show the user for any thrown value. */
export function messageOf(e: unknown): string {
  const { code, status } = (e ?? {}) as { code?: unknown; status?: unknown };
  if (typeof code === 'string' && FRIENDLY[code]) return FRIENDLY[code];
  if (typeof status === 'number' && status >= 500) return FRIENDLY.INTERNAL_ERROR!;
  if (e instanceof Error && e.message) return e.message;
  return FALLBACK;
}

/** Structured authorization failures only; network errors must not erase valid projections. */
export function isAccessDenied(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { status, code } = error as { status?: unknown; code?: unknown };
  return (
    [401, 403, 404].includes(Number(status)) ||
    ['42501', 'PGRST301', 'PGRST302', 'PGRST303'].includes(String(code))
  );
}
