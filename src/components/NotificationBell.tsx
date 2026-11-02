import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useUnreadCount } from '@/hooks/useUnreadCount';
import { badgeText } from '@/lib/inbox';

import { colors, fonts, MIN_TARGET } from './theme';

/** The Picks header's way into the inbox, with an unread count. */
export function NotificationBell() {
  const unread = useUnreadCount();
  const badge = badgeText(unread);
  return (
    <Pressable
      onPress={() => router.push('/inbox')}
      accessibilityRole="button"
      accessibilityLabel={unread ? `Notifications, ${unread} unread` : 'Notifications'}
      style={({ pressed }) => [styles.bell, pressed && styles.pressed]}
    >
      <Ionicons name="notifications-outline" size={22} color={colors.text} />
      {badge ? (
        <View style={styles.badge} importantForAccessibility="no-hide-descendants">
          <Text style={styles.badgeText} maxFontSizeMultiplier={1.2}>
            {badge}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bell: {
    width: MIN_TARGET,
    height: MIN_TARGET,
    borderRadius: MIN_TARGET / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
  },
  pressed: { opacity: 0.7 },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.bg,
  },
  badgeText: { fontFamily: fonts.bold, fontSize: 10, lineHeight: 13, color: colors.primaryText },
});
