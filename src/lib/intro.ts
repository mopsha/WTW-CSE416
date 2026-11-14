// Whether this device has already shown the signed-out intro carousel. Local only: it is
// about this phone, not the account, and must be readable before anyone signs in.
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'wtw.introSeen.v1';

/**
 * True once the intro was finished or someone signed in on this device. A storage failure
 * reads as "seen": skipping the intro is harmless, showing it on every launch is not.
 */
export async function hasSeenIntro(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) === '1';
  } catch {
    return true;
  }
}

/** Never throws; the worst case is seeing the intro once more. */
export async function markIntroSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, '1');
  } catch {
    /* Best effort. */
  }
}
