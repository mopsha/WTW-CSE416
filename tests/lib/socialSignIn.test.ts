import { Platform } from 'react-native';

// App Store 4.8: on iOS, Google sign-in is only offered next to Sign in with Apple.
jest.mock('@/lib/config', () => ({ USE_MOCK: false }));

// The module reads its flags when it loads, so set them before requiring it.
process.env.EXPO_PUBLIC_APPLE_SIGN_IN = '1';
process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = 'web-id';
process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID = 'ios-id';
const { googleSignInAvailable } =
  jest.requireActual<typeof import('@/lib/socialSignIn')>('@/lib/socialSignIn');

afterEach(() => jest.restoreAllMocks());

test('iOS hides Google when Apple is unavailable on the device, even with Apple enabled', () => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  expect(googleSignInAvailable(false)).toBe(false);
  expect(googleSignInAvailable(true)).toBe(true);
});

test('Android offers Google on its own (Apple has no native sheet there)', () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  expect(googleSignInAvailable(false)).toBe(true);
});
