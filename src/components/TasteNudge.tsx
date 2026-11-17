// Home's "Teach WTW your taste" card: for anyone who skipped the practice swipe and has never
// saved preferences. Dismissing it is remembered per account on this device.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useSession } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';

import { Button } from './Button';
import { Card } from './Card';
import { colors, fonts, MIN_TARGET, space, type } from './theme';

const keyFor = (userId: string) => `wtw.tasteNudgeDismissed.v1.${userId}`;

export function TasteNudge() {
  const { loading, failed, onboarded } = useProfile();
  const key = keyFor(useSession().user.id);
  // Which account's answer we hold; hidden until storage answers for this account, so a
  // dismissed card never flashes.
  const [stored, setStored] = useState<{ key: string; dismissed: boolean } | null>(null);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(key)
      .then((v) => active && setStored({ key, dismissed: v === '1' }))
      .catch(() => active && setStored({ key, dismissed: false }));
    return () => {
      active = false;
    };
  }, [key]);

  if (loading || failed || onboarded || stored?.key !== key || stored.dismissed) return null;

  function dismiss() {
    setStored({ key, dismissed: true });
    void AsyncStorage.setItem(key, '1').catch(() => {});
  }

  return (
    <Card>
      <View style={styles.row}>
        <Ionicons name="sparkles" size={22} color={colors.primary} accessible={false} />
        <Text style={styles.title} accessibilityRole="header">
          Teach WTW your taste
        </Text>
        <Pressable
          onPress={dismiss}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          style={styles.close}
        >
          <Ionicons name="close" size={20} color={colors.muted} />
        </Pressable>
      </View>
      <Text style={styles.body}>
        Swipe a few spots so your group’s Picks start with places you’ll actually like.
      </Text>
      <Button
        label="Start swiping"
        variant="secondary"
        onPress={() => router.push({ pathname: '/onboarding', params: { mode: 'taste' } })}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { flex: 1, fontFamily: fonts.bold, fontSize: 17, color: colors.text },
  close: {
    width: MIN_TARGET,
    height: MIN_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -space.sm,
  },
  body: { ...type.body, color: colors.muted },
});
