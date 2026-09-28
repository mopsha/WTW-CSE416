/** A message that is safe and useful to show the user for any thrown value. */
export function messageOf(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return 'Something went wrong. Please try again.';
}
