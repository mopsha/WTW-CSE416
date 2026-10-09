import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';

import { colors, fonts } from '@/components/theme';
import { haptic } from '@/lib/haptics';

type IconName = keyof typeof Ionicons.glyphMap;

function icon(active: IconName, inactive: IconName) {
  return function TabIcon({ color, focused }: { color: ColorValue; focused: boolean }) {
    return <Ionicons name={focused ? active : inactive} size={24} color={color} />;
  };
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        // minHeight (not height) so iOS still adds its home-indicator inset; Poppins needs the extra room.
        tabBarStyle: {
          backgroundColor: colors.bg,
          borderTopColor: colors.border,
          minHeight: 58,
          paddingTop: 4,
        },
        tabBarLabelStyle: { fontFamily: fonts.semibold, fontSize: 11, lineHeight: 16 },
        sceneStyle: { backgroundColor: colors.bg },
      }}
      screenListeners={{ tabPress: () => haptic.tick() }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Picks', tabBarIcon: icon('flame', 'flame-outline') }}
      />
      <Tabs.Screen
        name="discover"
        options={{ title: 'Discover', tabBarIcon: icon('compass', 'compass-outline') }}
      />
      <Tabs.Screen
        name="friends"
        options={{ title: 'Friends', tabBarIcon: icon('people', 'people-outline') }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: 'Profile', tabBarIcon: icon('person-circle', 'person-circle-outline') }}
      />
    </Tabs>
  );
}
