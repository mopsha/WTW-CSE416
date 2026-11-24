// A Friends link contains no account identity or parameters. Keep the fixed intent
// through the current sign-in and first-run flow, just like an incoming join code.
let pending = false;

export function setPendingFriends() {
  pending = true;
}

export function takePendingFriends(): boolean {
  const requested = pending;
  pending = false;
  return requested;
}
