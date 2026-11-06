import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { shareProfile } from '@/lib/profileSharing';
import { messageOf } from '@/lib/errors';
import { ErrorState } from '../ErrorState';
import { colors, fonts, MIN_TARGET, radius, space } from '../theme';
export function ProfileActions({
  userId,
  name,
  username,
  onEdit,
}: {
  userId: string;
  name: string | null;
  username: string | null;
  onEdit(): void;
}) {
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function share() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await shareProfile(userId, name, username);
    } catch (e) {
      if (mounted.current) setError(messageOf(e));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <View style={{ gap: space.sm }}>
      <View style={styles.row}>
        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
          onPress={onEdit}
          accessibilityRole="button"
          accessibilityLabel={`Edit profile for ${name || 'you'}`}
        >
          <Text style={styles.text}>Edit profile</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
          onPress={() => void share()}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Share profile"
          accessibilityState={{ busy, disabled: busy }}
        >
          <Text style={styles.text}>Share profile</Text>
        </Pressable>
      </View>
      {error ? <ErrorState message={error} /> : null}
    </View>
  );
}
const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm },
  button: {
    flex: 1,
    minHeight: MIN_TARGET + 4,
    padding: space.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.card,
  },
  text: {
    fontFamily: fonts.medium,
    fontSize: 16,
    color: colors.text,
    textAlign: 'center',
    flexShrink: 1,
  },
  pressed: { opacity: 0.65 },
});
