// An invite link waiting for sign-in (wtw://i/TOKEN). Like pendingJoin, the link screen parks
// it and the root layout resumes it once there is a session. Unlike a join code it is kept in
// expo-secure-store, so it survives the app being closed while the person signs in (e.g. to
// read the emailed code). SecureStore is native-only; on web it is kept in memory.
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { parseInviteToken } from '@shared/domain/inviteLink.ts';

const KEY = 'wtw.pendingInvite';
/** Links expire after 7 days, so an older parked token is useless. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const native = Platform.OS !== 'web';

let memory: string | null = null;

export async function setPendingInvite(token: string): Promise<void> {
  const parsed = parseInviteToken(token);
  if (!parsed) return;
  memory = parsed;
  if (!native) return;
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify({ token: parsed, savedAt: Date.now() }));
  } catch {
    // Memory still has it for this session.
  }
}

/** The parked token, cleared so it's resumed at most once. */
export async function takePendingInvite(now = Date.now()): Promise<string | null> {
  let token = memory;
  memory = null;
  if (native) {
    try {
      const raw = await SecureStore.getItemAsync(KEY);
      await SecureStore.deleteItemAsync(KEY);
      if (!token && raw) {
        const saved = JSON.parse(raw) as { token?: unknown; savedAt?: unknown };
        const fresh = typeof saved.savedAt === 'number' && now - saved.savedAt < MAX_AGE_MS;
        token = fresh && typeof saved.token === 'string' ? saved.token : null;
      }
    } catch {
      // Unreadable: treat as nothing parked.
    }
  }
  return token ? parseInviteToken(token) : null;
}
