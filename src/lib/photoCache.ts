// Only active presentation state lives here. Google photo names are consumed once, not kept
// as session-cache keys or retried. Retry/expiry requires fresh metadata from Discover.
import { api } from './api';

export const PHOTO_TTL_MS = 50 * 60_000;
export const FAILURE_TTL_MS = 5 * 60_000;
const MAX_PHOTOS = 200;
// Bound unused metadata from the current response too; this is a freshness safeguard,
// not a provider-granted caching allowance.
const METADATA_TTL_MS = FAILURE_TTL_MS;
export type PhotoSource = { readonly id: number };
type Entry = {
  owner: string;
  generation: number;
  name?: string;
  url?: string | null;
  expires: number;
  timer: ReturnType<typeof setTimeout>;
  promise?: Promise<string | null>;
};
let account: string | null = null;
let generation = 0;
let nextId = 0;
let revision = 0;
const entries = new Map<PhotoSource, Entry>();
// Names exist only while a resolution is in flight; never in the resolved-entry LRU.
type Pending = { promise: Promise<string | null>; cancel: () => void };
const pending = new Map<string, Pending>();
const REQUEST_TIMEOUT_MS = 15_000;
const listeners = new Set<() => void>();
function emit() {
  revision++;
  listeners.forEach((listener) => listener());
}
export const subscribePhotos = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const photoRevision = () => revision;

export function clearPhotoCache() {
  generation++;
  entries.forEach((entry) => clearTimeout(entry.timer));
  entries.clear();
  pending.forEach((request) => request.cancel());
  pending.clear();
  emit();
}
/** Called before publishing an auth change, including logout and a new session for the same user. */
export function setPhotoSession(owner: string | null) {
  account = owner;
  clearPhotoCache();
}
/** Consumers also enforce account boundaries (including isolated component mounts). */
export function setPhotoAccount(owner: string) {
  if (account !== owner) setPhotoSession(owner);
}
function expire(source: PhotoSource, entry: Entry) {
  clearTimeout(entry.timer);
  entry.name = undefined;
  entry.url = undefined;
  entry.promise = undefined;
  entry.expires = 0;
  if (entries.get(source) === entry) emit();
}
function deadline(source: PhotoSource, entry: Entry, ms: number) {
  clearTimeout(entry.timer);
  entry.expires = Date.now() + ms;
  entry.timer = setTimeout(() => expire(source, entry), ms);
}
/** Register fresh response metadata. The opaque handle contains no provider reference. */
export function photoSource(name: string, owner: string): PhotoSource {
  const source = { id: ++nextId };
  const entry: Entry = {
    owner,
    generation,
    name,
    expires: Date.now() + METADATA_TTL_MS,
    timer: setTimeout(() => expire(source, entry), METADATA_TTL_MS),
  };
  entries.set(source, entry);
  if (entries.size > MAX_PHOTOS) {
    const oldest = entries.keys().next().value;
    if (oldest) releasePhotos([oldest]);
  }
  return source;
}
export function releasePhotos(sources: readonly PhotoSource[]) {
  let changed = false;
  for (const source of sources) {
    const entry = entries.get(source);
    if (entry) {
      clearTimeout(entry.timer);
      entry.name = undefined;
      entry.url = undefined;
      entry.promise = undefined;
      entries.delete(source);
      changed = true;
    }
  }
  if (changed) emit();
}
export const isPhotoAccount = (owner: string) => account === owner;

export function photoState(source: PhotoSource) {
  const entry = entries.get(source);
  if (
    !entry ||
    entry.owner !== account ||
    entry.generation !== generation ||
    entry.expires <= Date.now()
  )
    return { url: undefined, expired: true, pending: true };
  return { url: entry.url, expired: false, pending: entry.url === undefined };
}
/** JS timers may be suspended in the background; the clock remains authoritative. */
export function revalidatePhotos(sources: readonly PhotoSource[]) {
  for (const source of sources) {
    const entry = entries.get(source);
    if (entry && entry.expires !== 0 && entry.expires <= Date.now()) expire(source, entry);
  }
}
/** Deduplicate only live requests in this session. Never reuse a consumed/expired name. */
export function loadPhoto(source: PhotoSource): Promise<string | null> {
  const entry = entries.get(source);
  if (!entry || photoState(source).expired) return Promise.resolve(null);
  entries.delete(source);
  entries.set(source, entry);
  if (entry.promise) return entry.promise;
  const name = entry.name;
  entry.name = undefined;
  if (!name) return Promise.resolve(null);
  const epoch = generation;
  let operation = pending.get(name);
  if (!operation) {
    let cancel = () => {};
    const promise = new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), REQUEST_TIMEOUT_MS);
      cancel = () => {
        clearTimeout(timer);
        resolve(null);
      };
      void api.discoverPhoto(name, entry.owner).then(
        ({ photoUrl }) => {
          clearTimeout(timer);
          resolve(photoUrl);
        },
        () => {
          clearTimeout(timer);
          resolve(null);
        },
      );
    });
    operation = { promise, cancel };
    pending.set(name, operation);
    const current = operation;
    void promise.then(() => {
      if (pending.get(name) === current) pending.delete(name);
    });
    if (pending.size > MAX_PHOTOS) {
      const oldest = pending.keys().next().value;
      if (oldest) {
        pending.get(oldest)?.cancel();
        pending.delete(oldest);
      }
    }
  }
  const request = operation.promise;
  entry.promise = request.then((url) => {
    if (epoch !== generation || entries.get(source) !== entry || photoState(source).expired)
      return null;
    entry.url = url;
    deadline(source, entry, url === null ? FAILURE_TTL_MS : PHOTO_TTL_MS);
    emit();
    return url;
  });
  return entry.promise;
}
