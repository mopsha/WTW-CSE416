/** A message that is safe and useful to show the user for any thrown value. */
export function messageOf(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return 'Something went wrong. Please try again.';
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
