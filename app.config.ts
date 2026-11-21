// Extends app.json (Expo passes it in as `config`). Sign in with Apple and Google need native
// setup that only works once their accounts are configured (docs/sign-in.md), so each is added
// only when its env var is set; until then builds are exactly what app.json describes.
//   EXPO_PUBLIC_APPLE_SIGN_IN=1                  → Apple entitlement + plugin (iOS)
//   EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=<id>.apps…  → Google plugin with its iOS URL scheme
import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  const plugins = [...(config.plugins ?? [])];
  const ios = { ...config.ios };

  if (process.env.EXPO_PUBLIC_APPLE_SIGN_IN === '1') {
    ios.usesAppleSignIn = true;
    plugins.push('expo-apple-authentication');
  }

  const googleIos = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  if (googleIos) {
    // The URL scheme is the iOS client ID reversed: <id>.apps.googleusercontent.com →
    // com.googleusercontent.apps.<id>.
    const id = googleIos.replace(/\.apps\.googleusercontent\.com$/, '');
    plugins.push([
      '@react-native-google-signin/google-signin',
      { iosUrlScheme: `com.googleusercontent.apps.${id}` },
    ]);
  }

  return { ...config, name: config.name ?? 'WTW', slug: config.slug ?? 'wtw', ios, plugins };
};
