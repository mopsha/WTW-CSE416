import { ProfileSkeleton } from '@/components/LoadingStates';
import { useAuth } from '@/hooks/useAuth';
import { useAvatarPhoto } from '@/hooks/useAvatarSource';
import { usePrivateRefresh } from '@/hooks/usePrivateRefresh';
import { PastMoves } from '@/components/PastMoves';
import { MemberMenu } from '@/components/MemberMenu';
import { MessageFriendButton } from '@/components/MessageFriendButton';
import type { UserProfile } from '@shared/api/userProfiles.ts';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Avatar, Screen, ErrorState, colors, space, type } from '@/components';
import { UserProfileMetadata } from '@/components/UserProfileMetadata';
import { api } from '@/lib/api';
import { messageOf } from '@/lib/errors';
export default function UserProfileScreen() {
  const { id = '', hangId } = useLocalSearchParams<{ id: string; hangId?: string }>();
  const { session } = useAuth();
  const viewer = session?.user.id;
  return (
    <UserProfileContent
      key={JSON.stringify([viewer, session?.user.email, id, hangId])}
      id={id}
      hangId={hangId}
      viewer={viewer}
    />
  );
}

type BasicProfile = Pick<UserProfile, 'id' | 'displayName' | 'username'>;

async function loadProfile(id: string, hangId?: string, viewer?: string) {
  try {
    return await api.getUserProfile(id);
  } catch (error) {
    if (!hangId || !viewer || Number((error as { status?: number } | null)?.status) !== 404)
      throw error;
    // For a shared Hang, show only identity already visible on its authorized card.
    const hang = await api.getHangPost(hangId, viewer);
    if (Date.parse(hang.expiresAt) <= Date.now()) throw error;
    const attendee = hang.attendees?.find((person) => person.userId === id);
    if (attendee) return { id, displayName: attendee.displayName, username: attendee.username };
    if (hang.authorId === id) return { id, displayName: hang.authorName ?? null, username: null };
    throw error;
  }
}

function UserProfileContent({
  id,
  hangId,
  viewer,
}: {
  id: string;
  hangId?: string;
  viewer?: string;
}) {
  const [profile, setProfile] = useState<UserProfile | BasicProfile | null>(null);
  const full = profile && 'metadataVisible' in profile ? profile : null;
  const photo = useAvatarPhoto(full?.avatarRef, profile?.id);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const latest = useRef(0);
  const load = useCallback(async () => {
    const request = ++latest.current;
    setError(null);
    setLoading(true);
    try {
      const value = await loadProfile(id, hangId, viewer);
      if (request === latest.current) setProfile(value);
    } catch (e) {
      if (request === latest.current) {
        setProfile(null);
        setError(messageOf(e));
      }
    } finally {
      if (request === latest.current) setLoading(false);
    }
  }, [id, hangId, viewer]);
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
        profile && !full?.isOwner ? (
          <MemberMenu
            userId={profile.id}
            photo={photo.ref ?? undefined}
            name={profile.displayName ?? 'WTW friend'}
            onBlocked={() => void load()}
          />
        ) : undefined
      }
    >
      {loading && !profile ? <ProfileSkeleton /> : null}
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {profile ? (
        <View style={{ gap: space.lg }}>
          <View style={{ alignItems: 'center', gap: space.sm }}>
            <Avatar
              name={profile.displayName ?? 'WTW friend'}
              uri={full?.avatarUrl}
              avatarRef={full?.avatarRef}
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
          {full ? (
            <>
              {!full.isOwner ? <MessageFriendButton userId={full.id} /> : null}
              <UserProfileMetadata profile={full} />
              <PastMoves key={`${full.id}:${full.metadataVisible}`} userId={full.id} />
            </>
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}
