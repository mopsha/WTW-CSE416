// A signed-out link belongs to the current auth flow. The first session binds it
// to that account before profile loading or onboarding can delay navigation.
let pending: { owner: string | null } | null = null;
const listeners = new Set<() => void>();

export function hasPendingFriends() {
  return pending !== null;
}

export function subscribePendingFriends(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setPendingFriends(owner: string | null) {
  pending = { owner };
  listeners.forEach((listener) => listener());
}

export function clearPendingFriends() {
  if (!pending) return;
  pending = null;
  listeners.forEach((listener) => listener());
}

export function bindPendingFriends(userId: string | null) {
  if (!pending) return;
  if (pending.owner === null) pending.owner = userId;
  else if (pending.owner !== userId) clearPendingFriends();
}

export function takePendingFriends(userId: string): boolean {
  const requested = pending?.owner === userId;
  if (requested) clearPendingFriends();
  return requested;
}
