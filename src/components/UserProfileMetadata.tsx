import { birthdayLabel } from '@shared/api/birthdays.ts';
import type { UserProfile } from '@shared/api/userProfiles.ts';
import { Text, View } from 'react-native';
import { colors, space, type } from '@/components';
import { ProfileFavorites } from './profile/ProfilePresentation';

export function UserProfileMetadata({ profile }: { profile: UserProfile }) {
  return (
    <View style={{ gap: space.md }}>
      {!profile.isOwner && profile.birthday ? (
        <Text style={{ ...type.caption, color: colors.muted }}>
          Birthday · {birthdayLabel(profile.birthday)}
        </Text>
      ) : null}
      <ProfileFavorites profile={profile} />
    </View>
  );
}
