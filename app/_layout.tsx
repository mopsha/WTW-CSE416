import { hasRequiredIdentity } from '@shared/api/userProfiles.ts';
import {
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
  Poppins_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/poppins';
import { router, Stack, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { Button, ErrorState, Screen } from '@/components';
import { colors } from '@/components/theme';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { ProfileProvider, useProfile } from '@/hooks/useProfile';
import { auth } from '@/lib/auth';
import { configureNotifications, onNotificationTap } from '@/lib/notify';
import { takePendingInvite } from '@/lib/pendingInvite';
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
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
    Poppins_800ExtraBold,
  });
  // A font failure falls back to the system font rather than blocking the app.
  const ready = !loading && !profile.loading && (fontsLoaded || !!fontError);
  const needsName =
    !!session && !profile.failed && !hasRequiredIdentity(profile.displayName, profile.username);
  const inApp = !!session && !profile.failed && !needsName;
  const pathname = usePathname();
  const offered = useRef<string | null>(null);
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

  // A join link that arrived signed out: once required identity is available, finish joining.
  useEffect(() => {
    if (!session) {
      offered.current = null;
      return;
    }
    if (!ready || !inApp) return;
    if (!profile.optionalSetupPending) offered.current = null;
    if (profile.optionalSetupPending && offered.current !== userId) {
      offered.current = userId ?? null;
      if (pathname !== '/onboarding') router.push('/onboarding');
      return;
    }
    if (pathname === '/onboarding') return;
    const code = takePendingJoin();
    if (code) {
      router.push({ pathname: '/join/[code]', params: { code } });
      return;
    }
    // Invite links are parked in SecureStore, so they survive a restart during sign-in.
    void takePendingInvite().then((token) => {
      if (token) router.push({ pathname: '/i/[token]', params: { token } });
    });
  }, [ready, inApp, userId, session, profile.optionalSetupPending, pathname]);

  // Keep the splash up until the stored session and fonts are loaded. Rendering the
  // guarded Stack earlier treats a signed-in user as signed out for a moment, which
  // redirects deep links (e.g. a reload on /pick/:id/swipe) back to Home.
  if (!ready)
    return session && !loading && profile.loading ? (
      <Screen title="Loading your profile…">{null}</Screen>
    ) : null;

  // A failed lookup says nothing about whether identity is complete. Keep the
  // navigator unmounted so a restored deep link is not redirected into onboarding.
  if (session && profile.failed)
    return (
      <Screen title="Could not load your profile">
        <ErrorState message="Check your connection and try again." onRetry={profile.retry} />
        <Button
          label="Sign out"
          variant="link"
          onPress={() => void auth.signOut().catch(() => {})}
        />
      </Screen>
    );

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
        <Stack.Protected guard={inApp}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="groups" />
          <Stack.Screen name="onboarding" />
          <Stack.Screen name="preferences" />
          <Stack.Screen name="settings/index" />
          <Stack.Screen name="settings/profile" />
          <Stack.Screen name="settings/blocked" />
          <Stack.Screen name="users/[id]" />
          <Stack.Screen name="messages/[id]" />
          <Stack.Screen name="pick/new" />
          <Stack.Screen name="pick/[id]/index" options={{ animation: 'fade' }} />
          <Stack.Screen name="pick/[id]/lobby" />
          <Stack.Screen name="pick/[id]/swipe" options={{ gestureEnabled: false }} />
          <Stack.Screen name="pick/[id]/waiting" options={{ animation: 'fade' }} />
          <Stack.Screen name="pick/[id]/results" options={{ animation: 'fade' }} />
          <Stack.Screen name="pick/[id]/vote" options={{ animation: 'fade' }} />
          <Stack.Screen name="pick/[id]/winner" options={{ animation: 'fade' }} />
          <Stack.Screen name="history" />
          <Stack.Screen name="inbox" />
        </Stack.Protected>
        {/* Join and invite links open signed in or out; the screen sends you to sign-in if needed.
            Listed last so it is never the guard's fallback screen. */}
        <Stack.Screen name="join/[code]" options={{ animation: 'fade' }} />
        <Stack.Screen name="i/[token]" options={{ animation: 'fade' }} />
      </Stack>
    </>
  );
}
