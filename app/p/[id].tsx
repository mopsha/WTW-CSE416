import { useProfile } from '@/hooks/useProfile';
import { hasRequiredIdentity } from '@shared/api/userProfiles.ts';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import type { PersonIdentity } from '@shared/api/people.ts';
import { useAuth } from '@/hooks/useAuth';
import { usePrivateRefresh } from '@/hooks/usePrivateRefresh';
import { api } from '@/lib/api';
import { profileTarget } from '@/lib/profileSharing';
import { setPendingProfile } from '@/lib/pendingProfile';
import { messageOf } from '@/lib/errors';
import { Button, ErrorState, Screen, colors, space, type } from '@/components';
import { SocialIdentity } from '@/components/friends/SocialRow';
import { PersonFriendAction } from '@/components/friends/UsernameFriendSearch';
import { MemberMenu } from '@/components/MemberMenu';
export default function SharedProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const target = profileTarget(id);
  const { session } = useAuth();
  const profile = useProfile();
  const ready =
    !!session &&
    !profile.loading &&
    !profile.failed &&
    hasRequiredIdentity(profile.displayName, profile.username);
  const viewer = ready && !profile.optionalSetupPending ? session?.user.id : undefined;
  const key = `${viewer}:${target}`;
  const [result, setResult] = useState<{ key: string; person: PersonIdentity } | null>(null);
  const person = result?.key === key ? result.person : null;
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);
  const load = useCallback(
    async (reconcile = false) => {
      if (!viewer || !target) return;
      const request = ++latest.current;
      try {
        const value = await api.getPerson(target);
        if (request === latest.current) {
          setResult({ key, person: value });
          setError(null);
        }
      } catch (e) {
        if (request === latest.current) {
          setResult(null);
          setError(messageOf(e));
        }
        if (reconcile) throw e;
      }
    },
    [viewer, target, key],
  );
  const clear = useCallback(() => {
    latest.current++;
    setResult(null);
    setError(null);
  }, []);
  usePrivateRefresh(load, clear);
  useEffect(() => {
    if (!target || profile.loading || profile.failed) return;
    if (!session || !ready || profile.optionalSetupPending) {
      let active = true;
      void setPendingProfile(target).then(() => {
        if (active && (!session || !ready)) router.replace(session ? '/welcome' : '/sign-in');
      });
      return () => {
        active = false;
      };
    }
  }, [session, target, profile.loading, profile.failed, profile.optionalSetupPending, ready]);
  return (
    <Screen title="Profile" back>
      {!target ? <ErrorState message="This profile link is invalid." /> : null}
      {target && !session ? (
        <Text style={{ ...type.body, color: colors.muted }}>Sign in to view this profile.</Text>
      ) : null}
      {target && session && !person && !error ? (
        <ActivityIndicator color={colors.primary} accessibilityLabel="Loading profile" />
      ) : null}
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {person && viewer ? (
        <View style={{ gap: space.lg }}>
          <View style={{ alignItems: 'center', gap: space.sm }}>
            <SocialIdentity
              name={person.displayName || person.username}
              userId={person.userId}
              avatarRef={person.avatarRef}
              size={84}
            />
            <Text style={{ ...type.heading, color: colors.text }}>
              {person.displayName || person.username}
            </Text>
            <Text style={{ ...type.body, color: colors.muted }}>@{person.username}</Text>
          </View>
          {['friends', 'self'].includes(person.relationship) ? (
            <Button
              label="View profile"
              variant="secondary"
              onPress={() =>
                router.push({ pathname: '/users/[id]', params: { id: person.userId } })
              }
            />
          ) : (
            <PersonFriendAction person={person} onChanged={() => load(true)} />
          )}
          {person.relationship !== 'self' ? (
            <MemberMenu
              userId={person.userId}
              name={person.displayName || person.username}
              onBlocked={() => void load()}
            />
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}
