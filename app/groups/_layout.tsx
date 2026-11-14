// Groups screens (list, detail). Full-screen Stack screens outside (tabs), like the Pick flow.
// The root Stack protects this navigator with the same required-identity guard as the tabs.
// Keep the local signed-out guard as a defensive fallback.
import { useReducedMotion } from 'react-native-reanimated';
import { Redirect, Stack } from 'expo-router';

import { colors } from '@/components/theme';
import { useAuth } from '@/hooks/useAuth';

export default function GroupsLayout() {
  const { session } = useAuth();
  const reducedMotion = useReducedMotion();
  if (!session) return <Redirect href="/sign-in" />;
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
        animation: 'fade_from_bottom',
      }}
    >
      <Stack.Screen
        name="[id]/details"
        options={{ animation: reducedMotion ? 'none' : 'default', gestureEnabled: true }}
      />
    </Stack>
  );
}
