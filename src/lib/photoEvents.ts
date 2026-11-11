import type { AvatarChange } from '@shared/api/avatars.ts';
type PhotoEvent = { userId: string; state?: AvatarChange };
const listeners = new Set<(event: PhotoEvent) => void>();
export function photoChanged(userId: string, state?: AvatarChange) {
  listeners.forEach((listener) => listener({ userId, state }));
}
export function subscribePhotoChanges(listener: (event: PhotoEvent) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
