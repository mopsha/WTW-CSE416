// A join code waiting for sign-in. wtw://join/CODE can arrive signed out; the auth guard then
// lands on Picks after sign-in and forgets the URL (Expo Router doesn't keep it), so the join
// screen parks the code here and the root layout resumes it once there is a session.
// In memory only: checking email for the sign-in code doesn't restart the app.
let pending: string | null = null;

export function setPendingJoin(code: string) {
  pending = code;
}

/** The parked code, cleared so it's resumed at most once. */
export function takePendingJoin(): string | null {
  const code = pending;
  pending = null;
  return code;
}
