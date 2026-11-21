// Native Sign in with Apple / Google → an ID token for Supabase (docs/sign-in.md).
// Each is off until its account setup is done and the build includes it (app.config.ts):
//   Apple:  EXPO_PUBLIC_APPLE_SIGN_IN=1 (iOS only; Apple's native sheet doesn't exist on Android)
//   Google: EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID (+ EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID for iOS)
// The native modules are loaded only when used, so builds without them never touch them.
import { Platform } from 'react-native';

import { USE_MOCK } from './config';

const APPLE_ON = process.env.EXPO_PUBLIC_APPLE_SIGN_IN === '1';
const GOOGLE_WEB = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';
const GOOGLE_IOS = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '';

/** Whether to show "Continue with Apple". */
export async function appleSignInAvailable(): Promise<boolean> {
  if (USE_MOCK || !APPLE_ON || Platform.OS !== 'ios') return false;
  try {
    const Apple = await import('expo-apple-authentication');
    return await Apple.isAvailableAsync();
  } catch {
    return false;
  }
}

/**
 * Whether to show "Continue with Google". On iOS only when Sign in with Apple is actually
 * shown (`appleAvailable`, from appleSignInAvailable): App Store guideline 4.8 requires
 * offering Apple whenever another third-party sign-in is offered. The build flag alone isn't
 * enough, since Apple can still be unavailable on the device.
 */
export function googleSignInAvailable(appleAvailable: boolean): boolean {
  if (USE_MOCK || !GOOGLE_WEB) return false;
  return Platform.OS === 'android' || (Platform.OS === 'ios' && !!GOOGLE_IOS && appleAvailable);
}

/** Apple's identity token (and, on first sign-in only, the user's name); null if canceled. */
export async function appleIdToken(): Promise<{ token: string; name: string | null } | null> {
  const Apple = await import('expo-apple-authentication');
  try {
    const credential = await Apple.signInAsync({
      requestedScopes: [
        Apple.AppleAuthenticationScope.FULL_NAME,
        Apple.AppleAuthenticationScope.EMAIL,
      ],
    });
    if (!credential.identityToken) throw new Error('Apple didn’t return a sign-in token.');
    const n = credential.fullName;
    const name = n ? [n.givenName, n.familyName].filter(Boolean).join(' ').trim() : '';
    return { token: credential.identityToken, name: name || null };
  } catch (e) {
    if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') return null;
    throw e;
  }
}

/** Google's ID token; null if canceled. */
export async function googleIdToken(): Promise<string | null> {
  const { GoogleSignin, isSuccessResponse } =
    await import('@react-native-google-signin/google-signin');
  GoogleSignin.configure({
    webClientId: GOOGLE_WEB,
    ...(GOOGLE_IOS ? { iosClientId: GOOGLE_IOS } : {}),
  });
  if (Platform.OS === 'android') await GoogleSignin.hasPlayServices();
  const response = await GoogleSignin.signIn();
  if (!isSuccessResponse(response)) return null;
  if (!response.data.idToken) throw new Error('Google didn’t return a sign-in token.');
  return response.data.idToken;
}
