// App Store 4.8: on iOS, Google sign-in is only offered next to Sign in with Apple.
jest.mock('@/lib/config', () => ({ USE_MOCK: false }));

function load(os: 'ios' | 'android') {
  process.env.EXPO_PUBLIC_APPLE_SIGN_IN = '1';
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = 'web-id';
  process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID = 'ios-id';
  let mod!: typeof import('@/lib/socialSignIn');
  jest.isolateModules(() => {
    jest.doMock('react-native', () => ({ Platform: { OS: os } }));
    mod = jest.requireActual('@/lib/socialSignIn');
  });
  return mod;
}

afterEach(() => {
  delete process.env.EXPO_PUBLIC_APPLE_SIGN_IN;
  delete process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  delete process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
});

test('iOS hides Google when Apple is unavailable on the device, even with Apple enabled', () => {
  const { googleSignInAvailable } = load('ios');
  expect(googleSignInAvailable(false)).toBe(false);
  expect(googleSignInAvailable(true)).toBe(true);
});

test('Android offers Google on its own (Apple has no native sheet there)', () => {
  const { googleSignInAvailable } = load('android');
  expect(googleSignInAvailable(false)).toBe(true);
});
