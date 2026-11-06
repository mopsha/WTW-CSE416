// A profile link waiting for sign-in (wtw://p/UUID). Like pendingJoin, the link screen parks
// it and the root layout resumes it once there is a session. Unlike a join code it is kept in
// expo-secure-store, so it survives the app being closed while the person signs in (e.g. to
// read the emailed code). SecureStore is native-only; on web it is kept in memory.
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { profileTarget } from './profileSharing';

const KEY = 'wtw.pendingProfile';
/** Bound the local sign-in intent; profile links themselves have no time-based expiry. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const native = Platform.OS !== 'web';

let queue: Promise<void> = Promise.resolve();
let writeVersion = 0;
let boundary = 0;
let intentSequence = 0;
let lastConsumedRaw: string | null = null;
function serialize<T>(work: () => Promise<T>): Promise<T> {
  const result = queue.then(work, work);
  queue = result.then(
    () => {},
    () => {},
  );
  return result;
}
let memory: { target: string; savedAt: number; version: number; owner?: string } | null = null;

async function save(target: string, owner?: string): Promise<void> {
  const parsed = profileTarget(target);
  if (!parsed) return;
  memory = {
    target: parsed,
    savedAt: Date.now(),
    version: ++intentSequence,
    ...(owner ? { owner } : {}),
  };
  if (!native) return;
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(memory));
  } catch {
    // Memory still has it for this session.
  }
}

/** The parked target, cleared so it's resumed at most once. */
async function take(now: number, viewer?: string): Promise<string | null> {
  const pending = memory;
  let target =
    pending &&
    (!pending.owner || pending.owner === viewer) &&
    pending.savedAt <= now &&
    now - pending.savedAt < MAX_AGE_MS
      ? pending.target
      : null;
  memory = null;
  if (native) {
    try {
      const stored = await SecureStore.getItemAsync(KEY);
      const raw = stored === lastConsumedRaw ? null : stored;
      if (stored) lastConsumedRaw = stored;
      await SecureStore.deleteItemAsync(KEY);
      if (!target && raw) {
        const saved = JSON.parse(raw) as { target?: unknown; savedAt?: unknown; owner?: string };
        const fresh =
          typeof saved.savedAt === 'number' &&
          saved.savedAt <= now &&
          now - saved.savedAt < MAX_AGE_MS;
        target =
          fresh && (!saved.owner || saved.owner === viewer) && typeof saved.target === 'string'
            ? saved.target
            : null;
      }
    } catch {
      // A subsequent reader must not replay the persisted copy of a memory intent.
      if (target && pending) lastConsumedRaw = JSON.stringify(pending);
    }
  }
  return target ? profileTarget(target) : null;
}

export function setPendingProfile(target: string, owner?: string): Promise<void> {
  if (!profileTarget(target)) return Promise.resolve();
  writeVersion++;
  return serialize(() => save(target, owner));
}
export function takePendingProfile(now = Date.now(), viewer?: string): Promise<string | null> {
  // Serialize consumers, not their results: only the first gets the stored target.
  const epoch = boundary;
  return serialize(async () => {
    const target = await take(now, viewer);
    return epoch === boundary ? target : null;
  });
}
/** Return true when stale work restored an intent and a current effect should retry. */
export async function resumePendingProfile(
  isCurrent: () => boolean,
  navigate: (id: string) => void,
  viewer?: string,
): Promise<boolean> {
  if (!isCurrent()) return false;
  const version = writeVersion;
  const epoch = boundary;
  const target = await takePendingProfile(Date.now(), viewer);
  if (!target || epoch !== boundary) return false;
  if (isCurrent()) {
    navigate(target);
    return false;
  }
  await serialize(async () => {
    // Do not overwrite a newer link arriving while this read was pending.
    if (writeVersion === version && epoch === boundary) await save(target, viewer);
  });
  return true;
}

/** Invalidate in-flight consumers immediately, then clear the persisted copy in order. */
export function clearPendingProfile(): Promise<void> {
  boundary++;
  writeVersion++;
  memory = null;
  return serialize(async () => {
    memory = null;
    if (!native) return;
    try {
      lastConsumedRaw = await SecureStore.getItemAsync(KEY);
      if (!lastConsumedRaw || lastConsumedRaw === 'null') return;
    } catch {
      /* Clear without a read. */
    }
    try {
      await SecureStore.deleteItemAsync(KEY);
      return;
    } catch {
      /* Try a persisted tombstone. */
    }
    try {
      await SecureStore.setItemAsync(KEY, 'null');
    } catch {
      throw new Error('Could not clear the pending profile link. Please try signing out again.');
    }
  });
}
