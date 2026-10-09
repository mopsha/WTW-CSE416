import { StyleSheet, Text, View } from 'react-native';

import { Avatar, Button, Card, colors, Screen, space, type } from '@/components';
import { useSession } from '@/hooks/useAuth';
import { auth } from '@/lib/auth';

// Minimal profile so sign-out has a home. Razin's profile screen replaces the body.
export default function ProfileScreen() {
  const session = useSession();
  const email = session.user.email ?? 'you';
  const name = email.split('@')[0] ?? email;

  return (
    <Screen title="Profile" edges={['top', 'left', 'right']}>
      <Card>
        <View style={styles.row}>
          <Avatar name={name} size={56} />
          <View style={styles.who}>
            <Text style={styles.name}>{name}</Text>
            <Text style={styles.email}>{email}</Text>
          </View>
        </View>
      </Card>
      <Button
        label="Sign out"
        variant="danger"
        icon="log-out-outline"
        onPress={() => void auth.signOut()}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  who: { flex: 1, gap: 2 },
  name: { ...type.heading, color: colors.text },
  email: { ...type.caption, color: colors.muted },
});
