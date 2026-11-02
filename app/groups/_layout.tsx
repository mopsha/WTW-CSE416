// Groups screens (list, detail). Full-screen Stack screens outside (tabs), like the Pick flow.
// The root Stack lists its protected screens by name; rather than edit it, this layout keeps
// the same guard: signed out, go to sign-in.
import { Redirect, Stack } from 'expo-router';

import { colors } from '@/components/theme';
import { useAuth } from '@/hooks/useAuth';

export default function GroupsLayout() {
  const { session } = useAuth();
  if (!session) return <Redirect href="/sign-in" />;
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
        animation: 'fade_from_bottom',
      }}
    />
  );
}
