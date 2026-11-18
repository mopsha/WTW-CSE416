// Discover covers for the whole session, shared by Discover and the onboarding taste deck so
// the same photo is never paid for twice. Keyed by Google's photo name, not the place: a place
// can come back with a different photo, and its credit must match the image shown.
import { api } from './api';

const MAX_PHOTOS = 200;
// Google's photo URLs are short-lived; a failure (often the daily limit) is retried later.
const PHOTO_TTL_MS = 50 * 60_000;
const FAILURE_TTL_MS = 5 * 60_000;

const photos = new Map<string, { url: Promise<string | null>; expires: number }>();

/** The cover URL for a photo name, or null if it couldn't load. Concurrent calls share one request. */
export function loadPhoto(name: string, now = Date.now()): Promise<string | null> {
  const hit = photos.get(name);
  photos.delete(name);
  if (hit && hit.expires > now) {
    photos.set(name, hit);
    return hit.url;
  }
  const entry = { url: Promise.resolve<string | null>(null), expires: now + PHOTO_TTL_MS };
  entry.url = api.discoverPhoto(name).then(
    ({ photoUrl }) => photoUrl,
    () => {
      entry.expires = Math.min(entry.expires, Date.now() + FAILURE_TTL_MS);
      return null;
    },
  );
  photos.set(name, entry);
  // Least recently used first.
  if (photos.size > MAX_PHOTOS) photos.delete(photos.keys().next().value!);
  return entry.url;
}

export function clearPhotoCache() {
  photos.clear();
}
