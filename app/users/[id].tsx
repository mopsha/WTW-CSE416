import type { UserProfile } from '@shared/api/userProfiles.ts';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
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
    setLoading(true);
    setProfile(null);
    setError(null);
    try {
      const value = await api.getUserProfile(id);
      if (request === latest.current) setProfile(value);
    } catch (e) {
      if (request === latest.current) setError(messageOf(e));
    } finally {
      if (request === latest.current) setLoading(false);
    }
  }, [id]);
  useFocusEffect(
    useCallback(() => {
      void load();
      return () => {
        latest.current++;
      };
    }, [load]),
  );
  return (
    <Screen title="Profile" back onRefresh={() => void load()}>
      {loading ? (
        <ActivityIndicator color={colors.primary} accessibilityLabel="Loading profile" />
      ) : null}
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {profile ? (
        <View style={{ gap: space.lg }}>
          <View style={{ alignItems: 'center', gap: space.sm }}>
            <Avatar name={profile.displayName ?? 'WTW friend'} uri={profile.avatarUrl} size={84} />
            <Text style={{ ...type.heading, color: colors.text }}>
              {profile.displayName ?? 'WTW friend'}
            </Text>
            {profile.username ? (
              <Text style={{ ...type.body, color: colors.muted }}>@{profile.username}</Text>
            ) : null}
          </View>
          <UserProfileMetadata profile={profile} />
        </View>
      ) : null}
    </Screen>
  );
}
