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
import { configureNotifications, onNotificationTap } from '@/lib/notify';
import { takePendingJoin } from '@/lib/pendingJoin';

void SplashScreen.preventAutoHideAsync();
configureNotifications();

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <AuthProvider>
        <RootStack />
      </AuthProvider>
    </GestureHandlerRootView>
  );
}

function RootStack() {
  const { session, loading } = useAuth();
  const [fontsLoaded, fontError] = useFonts({
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
    Poppins_800ExtraBold,
  });
  // A font failure falls back to the system font rather than blocking the app.
  const ready = !loading && (fontsLoaded || !!fontError);

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  // Tapping a WTW notification opens the screen it points at (e.g. the results).
  useEffect(() => onNotificationTap((url) => router.push(url as never)), []);

  // A join link that arrived signed out: once signed in, finish joining.
  useEffect(() => {
    if (!ready || !session) return;
    const code = takePendingJoin();
    if (code) router.push({ pathname: '/join/[code]', params: { code } });
  }, [ready, session]);

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
        <Stack.Protected guard={!!session}>
          <Stack.Screen name="(tabs)" />
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
