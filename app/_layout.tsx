import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { colors } from '@/components/theme';
import { AuthProvider, useAuth } from '@/hooks/useAuth';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <RootStack />
      </AuthProvider>
    </GestureHandlerRootView>
  );
}

function RootStack() {
  const { session, loading } = useAuth();

  useEffect(() => {
    if (!loading) void SplashScreen.hideAsync();
  }, [loading]);

  // Keep the splash up until the stored session is read. Rendering the guarded Stack
  // earlier treats a signed-in user as signed out for a moment, which redirects deep
  // links (e.g. a reload on /pick/:id/swipe) back to Home.
  if (loading) return null;

  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerTintColor: colors.primary,
          headerTitleStyle: { color: colors.text },
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Protected guard={!session}>
          <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={!!session}>
          <Stack.Screen name="index" options={{ title: 'Your Picks' }} />
          <Stack.Screen name="pick/[id]/swipe" options={{ title: 'Swipe' }} />
          <Stack.Screen name="pick/[id]/results" options={{ title: 'Results' }} />
        </Stack.Protected>
      </Stack>
    </>
  );
}
