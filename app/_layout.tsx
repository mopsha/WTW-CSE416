import {
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
  Poppins_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/poppins';
import { router, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { colors } from '@/components/theme';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { ProfileProvider, useProfile } from '@/hooks/useProfile';
import { configureNotifications, onNotificationTap } from '@/lib/notify';
import { takePendingJoin } from '@/lib/pendingJoin';
import { registerForPush } from '@/lib/push';

void SplashScreen.preventAutoHideAsync();
configureNotifications();

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <AuthProvider>
        <ProfileProvider>
          <RootStack />
        </ProfileProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}

function RootStack() {
  const { session, loading } = useAuth();
  const profile = useProfile();
  const [fontsLoaded, fontError] = useFonts({
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
    Poppins_800ExtraBold,
  });
  // A font failure falls back to the system font rather than blocking the app.
  const ready = !loading && !profile.loading && (fontsLoaded || !!fontError);
  // First sign-in: ask "what should we call you?" before anything else. If the profile
  // couldn't be read, don't block the app on it; the Profile tab can still set a name.
  const needsName = !!session && !profile.displayName && !profile.failed;
  // Then the survey and permission explainers, once (FR-02). Same rule: never block on a failed read.
  const needsOnboarding = !!session && !needsName && !profile.onboarded && !profile.failed;
  const inApp = !!session && !needsName && !needsOnboarding;
  const userId = session?.user.id;

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  // Keep this device's push token current on every start (it can change; Alan's route upserts).
  useEffect(() => {
    if (ready && inApp && userId) void registerForPush();
  }, [ready, inApp, userId]);

  // Tapping a WTW notification opens the screen it points at (e.g. the results), including
  // the tap that launched the app; wait for the signed-in stack so the route exists.
  useEffect(() => {
    if (!ready || !inApp) return;
    return onNotificationTap((route) => router.push(route as never));
  }, [ready, inApp]);

  // A join link that arrived signed out: once signed in (named and onboarded), finish joining.
  useEffect(() => {
    if (!ready || !inApp) return;
    const code = takePendingJoin();
    if (code) router.push({ pathname: '/join/[code]', params: { code } });
  }, [ready, inApp]);

  // Keep the splash up until the stored session and fonts are loaded. Rendering the
  // guarded Stack earlier treats a signed-in user as signed out for a moment, which
  // redirects deep links (e.g. a reload on /pick/:id/swipe) back to Home.
  if (!ready) return null;

  // Every Pick screen draws its own top bar (the demo look), so the native header is off.
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
          animation: 'fade_from_bottom',
        }}
      >
        <Stack.Protected guard={!session}>
          <Stack.Screen name="sign-in" />
        </Stack.Protected>
        <Stack.Protected guard={needsName}>
          <Stack.Screen name="welcome" />
        </Stack.Protected>
        <Stack.Protected guard={needsOnboarding}>
          <Stack.Screen name="onboarding" />
        </Stack.Protected>
        <Stack.Protected guard={inApp}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="preferences" />
          <Stack.Screen name="pick/new" />
          <Stack.Screen name="pick/[id]/index" options={{ animation: 'fade' }} />
          <Stack.Screen name="pick/[id]/lobby" />
          <Stack.Screen name="pick/[id]/swipe" options={{ gestureEnabled: false }} />
          <Stack.Screen name="pick/[id]/waiting" options={{ animation: 'fade' }} />
          <Stack.Screen name="pick/[id]/results" options={{ animation: 'fade' }} />
          <Stack.Screen name="pick/[id]/vote" options={{ animation: 'fade' }} />
          <Stack.Screen name="pick/[id]/winner" options={{ animation: 'fade' }} />
        </Stack.Protected>
        {/* Join links open signed in or out; the screen sends you to sign-in if needed.
            Listed last so it is never the guard's fallback screen. */}
        <Stack.Screen name="join/[code]" options={{ animation: 'fade' }} />
      </Stack>
    </>
  );
}
