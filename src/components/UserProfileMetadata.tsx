import { birthdayLabel } from '@shared/api/birthdays.ts';
import type { UserProfile } from '@shared/api/userProfiles.ts';
import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { Card, colors, space, type } from '@/components';
import { ListRow, SectionHeading } from './TabUi';
export function UserProfileMetadata({ profile }: { profile: UserProfile }) {
  const birthday =
    !profile.isOwner && profile.birthday ? (
      <Text style={{ ...type.body, color: colors.text }}>
        Birthday · {birthdayLabel(profile.birthday)}
      </Text>
    ) : null;
  if (!profile.metadataVisible)
    return (
      <View style={{ gap: space.sm }}>
        {birthday}
        <Text style={{ ...type.caption, color: colors.muted }}>Profile details are private.</Text>
      </View>
    );
  return (
    <View style={{ gap: space.md }}>
      {birthday}
      <Card>
        <Text style={{ ...type.body, color: colors.text }}>
          {profile.friendsCount ?? 0} friends · {profile.groupsCount ?? 0} groups
        </Text>
      </Card>
      {profile.favoriteCuisine ? (
        <Card>
          <Text style={{ ...type.caption, color: colors.muted }}>Favorite cuisine</Text>
          <Text style={{ ...type.body, color: colors.text }}>{profile.favoriteCuisine}</Text>
        </Card>
      ) : null}
      {profile.favoriteActivity ? (
        <Card>
          <Text style={{ ...type.caption, color: colors.muted }}>Favorite activity</Text>
          <Text style={{ ...type.body, color: colors.text }}>{profile.favoriteActivity}</Text>
        </Card>
      ) : null}
      {profile.mutualGroups.length ? (
        <View style={{ gap: space.sm }}>
          <SectionHeading title="Mutual groups" />
          <Card>
            {profile.mutualGroups.map((g) => (
              <ListRow
                key={g.id}
                title={g.name}
                onPress={() => router.push({ pathname: '/groups/[id]', params: { id: g.id } })}
              />
            ))}
          </Card>
        </View>
      ) : null}
    </View>
  );
}
