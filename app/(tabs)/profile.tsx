import { ProfileActions } from '@/components/profile/ProfileActions';
import { profileTheme } from '@/components/theme';
import {
  ProfileHero,
  ProfileFavorites,
  ProfileRow,
} from '@/components/profile/ProfilePresentation';
import { PastMoves } from '@/components/PastMoves';
import type { UserProfile } from '@shared/api/userProfiles.ts';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { colors, ErrorState, radius, Screen, space } from '@/components';
import { useAction } from '@/hooks/useAction';
import { useSession } from '@/hooks/useAuth';
import { suggestedName, useProfile } from '@/hooks/useProfile';
import { api } from '@/lib/api';
import { accountActions } from '@/lib/accountActions';
import { preferencesSummary } from '@/lib/preferences';

// My name (what friends see in Picks), my email, preferences, notifications, sign-out, and
// account deletion (App Store 5.1.1(v): reachable from here in two taps).
export default function ProfileScreen() {
  const session = useSession();
  const { displayName, username, preferences } = useProfile();
  const email = session.user.email ?? 'you';
  const name = displayName || suggestedName(session.user.email) || email;
  const [details, setDetails] = useState<UserProfile | null>(null);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const { busy, error, run } = useAction();

  const loadDetails = useCallback(async () => {
    try {
      setDetails(await api.getMyUserProfile());
      setDetailsError(null);
    } catch (e) {
      setDetails(null);
      setDetailsError(e instanceof Error ? e.message : 'Could not load profile details');
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      void loadDetails();
    }, [loadDetails]),
  );

  async function deleteAccount() {
    await run('delete', () => accountActions.deleteAccount());
  }

  return (
    <Screen edges={['top', 'left', 'right']} contentStyle={styles.content}>
      <ProfileHero name={name} profile={details} userId={session.user.id} />
      <ProfileActions
        userId={session.user.id}
        name={details?.displayName ?? displayName}
        username={details?.username ?? username}
        onEdit={() => router.push('/settings/profile')}
      />
      {!details && !detailsError ? (
        <ActivityIndicator color={colors.primary} accessibilityLabel="Loading profile details" />
      ) : null}
      {detailsError ? (
        <ErrorState message={detailsError} onRetry={() => void loadDetails()} />
      ) : null}
      {details ? <ProfileFavorites profile={details} /> : null}
      <PastMoves key={session.user.id} userId={session.user.id} variant="profile" />
      <View style={styles.account}>
        <View style={styles.settings}>
          <ProfileRow
            title="Preferences"
            subtitle={preferencesSummary(preferences)}
            icon="heart-outline"
            onPress={() => router.push('/preferences')}
          />
          <ProfileRow
            title="Notifications"
            icon="notifications-outline"
            onPress={() =>
              router.push({ pathname: '/settings', params: { section: 'notifications' } })
            }
          />
          <ProfileRow
            title="Settings"
            icon="settings-outline"
            onPress={() => router.push('/settings')}
          />
        </View>
        {error ? <ErrorState message={error} /> : null}
        <View style={styles.footer}>
          <ProfileRow
            title="Sign out"
            tone="accent"
            disabled={!!busy}
            icon="log-out-outline"
            onPress={() => void run('logout', () => accountActions.logOut())}
          />
          <ProfileRow
            title="Delete account"
            tone="quiet"
            disabled={!!busy}
            icon="trash-outline"
            loading={busy === 'delete'}
            onPress={() => void deleteAccount()}
          />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.lg, paddingTop: space.sm },
  account: { marginTop: space.xl, gap: space.lg },
  settings: { backgroundColor: profileTheme.surface, borderRadius: radius.md, overflow: 'hidden' },
  footer: { paddingTop: space.sm, paddingBottom: space.lg },
});
