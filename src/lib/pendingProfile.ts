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
let memory: { target: string; savedAt: number; version: number } | null = null;

async function save(target: string): Promise<void> {
  const parsed = profileTarget(target);
  if (!parsed) return;
  memory = { target: parsed, savedAt: Date.now(), version: ++intentSequence };
  if (!native) return;
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(memory));
  } catch {
    // Memory still has it for this session.
  }
}

/** The parked target, cleared so it's resumed at most once. */
async function take(now: number): Promise<string | null> {
  const pending = memory;
  let target =
    pending && pending.savedAt <= now && now - pending.savedAt < MAX_AGE_MS ? pending.target : null;
  memory = null;
  if (native) {
    try {
      const stored = await SecureStore.getItemAsync(KEY);
      const raw = stored === lastConsumedRaw ? null : stored;
      if (stored) lastConsumedRaw = stored;
      await SecureStore.deleteItemAsync(KEY);
      if (!target && raw) {
        const saved = JSON.parse(raw) as { target?: unknown; savedAt?: unknown };
        const fresh =
          typeof saved.savedAt === 'number' &&
          saved.savedAt <= now &&
          now - saved.savedAt < MAX_AGE_MS;
        target = fresh && typeof saved.target === 'string' ? saved.target : null;
      }
    } catch {
      // A subsequent reader must not replay the persisted copy of a memory intent.
      if (target && pending) lastConsumedRaw = JSON.stringify(pending);
    }
  }
  return target ? profileTarget(target) : null;
}

export function setPendingProfile(target: string): Promise<void> {
  if (!profileTarget(target)) return Promise.resolve();
  writeVersion++;
  return serialize(() => save(target));
}
export function takePendingProfile(now = Date.now()): Promise<string | null> {
  // Serialize consumers, not their results: only the first gets the stored target.
  return serialize(() => take(now));
}
/** Return true when stale work restored an intent and a current effect should retry. */
export async function resumePendingProfile(
  isCurrent: () => boolean,
  navigate: (id: string) => void,
): Promise<boolean> {
  if (!isCurrent()) return false;
  const version = writeVersion;
  const target = await takePendingProfile();
  if (!target) return false;
  if (isCurrent()) {
    navigate(target);
    return false;
  }
  await serialize(async () => {
    // Do not overwrite a newer link arriving while this read was pending.
    if (writeVersion === version) await save(target);
  });
  return true;
}
