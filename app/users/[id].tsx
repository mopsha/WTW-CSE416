import { usePrivateRefresh } from '@/hooks/usePrivateRefresh';
import { PastMoves } from '@/components/PastMoves';
import { MemberMenu } from '@/components/MemberMenu';
import { MessageFriendButton } from '@/components/MessageFriendButton';
import type { UserProfile } from '@shared/api/userProfiles.ts';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Avatar, Screen, ErrorState, colors, space, type } from '@/components';
import { UserProfileMetadata } from '@/components/UserProfileMetadata';
import { api } from '@/lib/api';
import { messageOf } from '@/lib/errors';
export default function UserProfileScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const latest = useRef(0);
  const load = useCallback(async () => {
    const request = ++latest.current;
    setError(null);
    try {
      const value = await api.getUserProfile(id);
      if (request === latest.current) setProfile(value);
    } catch (e) {
      if (request === latest.current) {
        setProfile(null);
        setError(messageOf(e));
      }
    } finally {
      if (request === latest.current) setLoading(false);
    }
  }, [id]);
  const clear = useCallback(() => {
    latest.current++;
    setProfile(null);
    setLoading(true);
    setError(null);
  }, []);
  usePrivateRefresh(load, clear);
  return (
    <Screen
      title="Profile"
      back
      onRefresh={() => void load()}
      right={
        profile && !profile.isOwner ? (
          <MemberMenu
            userId={profile.id}
            name={profile.displayName ?? 'WTW friend'}
            onBlocked={() => void load()}
          />
        ) : undefined
      }
    >
      {loading ? (
        <ActivityIndicator color={colors.primary} accessibilityLabel="Loading profile" />
      ) : null}
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {profile ? (
        <View style={{ gap: space.lg }}>
          <View style={{ alignItems: 'center', gap: space.sm }}>
            <Avatar
              name={profile.displayName ?? 'WTW friend'}
              uri={profile.avatarUrl}
              avatarRef={profile.avatarRef}
              userId={profile.id}
              size={84}
            />
            <Text style={{ ...type.heading, color: colors.text }}>
              {profile.displayName ?? 'WTW friend'}
            </Text>
            {profile.username ? (
              <Text style={{ ...type.body, color: colors.muted }}>@{profile.username}</Text>
            ) : null}
          </View>
          {!profile.isOwner ? <MessageFriendButton userId={profile.id} /> : null}
          <UserProfileMetadata profile={profile} />
          <PastMoves key={`${profile.id}:${profile.metadataVisible}`} userId={profile.id} />
        </View>
      ) : null}
    </Screen>
  );
}
