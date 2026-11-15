import { ProfileSkeleton } from '@/components/LoadingStates';
import { usePrivateRefresh } from '@/hooks/usePrivateRefresh';
import { isAccessDenied, messageOf } from '@/lib/errors';
import { ProfileActions } from '@/components/profile/ProfileActions';
import { profileTheme } from '@/components/theme';
import {
  ProfileHero,
  ProfileFavorites,
  ProfileRow,
} from '@/components/profile/ProfilePresentation';
import { PastMoves } from '@/components/PastMoves';
import type { UserProfile } from '@shared/api/userProfiles.ts';
import { router } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ErrorState, radius, Screen, space } from '@/components';
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
  return <OwnProfile key={session.user.id} />;
}
function OwnProfile() {
  const session = useSession();
  const { displayName, username, preferences } = useProfile();
  const email = session.user.email ?? 'you';
  const name = displayName || suggestedName(session.user.email) || email;
  const [details, setDetails] = useState<UserProfile | null>(null);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const { busy, error, run } = useAction();

  const latest = useRef(0);
  const active = useRef(false);
  const userId = session.user.id;
  const clear = useCallback(() => {
    active.current = false;
    latest.current++;
    setDetails(null);
    setDetailsError(null);
  }, []);
  const loadDetails = useCallback(async () => {
    if (!active.current) return;
    const request = ++latest.current;
    setDetailsError(null);
    try {
      const next = await api.getMyUserProfile();
      if (!active.current || latest.current !== request) return;
      if (next.id !== userId || !next.isOwner) {
        setDetails(null);
        setDetailsError('Could not verify profile details. Please try again.');
        return;
      }
      setDetails(next);
      setDetailsError(null);
    } catch (e) {
      if (!active.current || latest.current !== request) return;
      if (isAccessDenied(e)) setDetails(null);
      setDetailsError(messageOf(e));
    }
  }, [userId]);
  const refresh = useCallback(() => {
    active.current = true;
    return loadDetails();
  }, [loadDetails]);
  usePrivateRefresh(refresh, clear);

  async function deleteAccount() {
    await run('delete', () => accountActions.deleteAccount());
  }

  return (
    <Screen edges={['top', 'left', 'right']} contentStyle={styles.content}>
      {!details && !detailsError ? (
        <ProfileSkeleton own />
      ) : details ? (
        <ProfileHero name={name} profile={details} userId={session.user.id} />
      ) : null}
      <ProfileActions
        userId={session.user.id}
        name={details?.displayName ?? displayName}
        username={details?.username ?? username}
        onEdit={() => router.push('/settings/profile')}
      />
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
