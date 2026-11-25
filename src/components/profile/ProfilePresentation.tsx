import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import type { UserProfile } from '@shared/api/userProfiles.ts';
import { Avatar } from '../Avatar';
import { Card } from '../Card';
import { colors, fonts, profileTheme, radius, space, type } from '../theme';

export function ProfileHero({
  name,
  profile,
  userId,
  username = profile?.username,
}: {
  name: string;
  profile: UserProfile | null;
  userId?: string;
  username?: string | null;
}) {
  const friends = profile?.friendsCount ?? 0;
  const groups = profile?.groupsCount ?? 0;
  return (
    <View style={s.hero}>
      <View style={s.avatarFrame}>
        <Avatar
          name={name}
          uri={profile?.avatarUrl}
          userId={profile?.id ?? userId}
          avatarRef={profile?.avatarRef}
          neutral
          size={64}
        />
      </View>
      <View style={s.identity}>
        <Text style={s.name} accessibilityRole="header">
          {name}
        </Text>
        {username ? <Text style={s.username}>@{username}</Text> : null}
        {profile?.metadataVisible ? (
          <Text style={s.stats}>
            {`${friends} ${friends === 1 ? 'friend' : 'friends'} · ${groups} ${groups === 1 ? 'group' : 'groups'}`}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
export function ProfileFavorites({ profile }: { profile: UserProfile }) {
  const { fontScale } = useWindowDimensions();
  if (!profile.metadataVisible)
    return <Text style={s.secondary}>Profile details are private.</Text>;
  if (!profile.favoriteCuisine && !profile.favoriteActivity && !profile.mutualGroups.length)
    return null;
  const favorites = [
    { label: 'Favorite cuisine', value: profile.favoriteCuisine, icon: 'restaurant-outline' },
    { label: 'Favorite activity', value: profile.favoriteActivity, icon: 'sparkles-outline' },
  ] as const;

  return (
    <View style={s.favorites}>
      {favorites.some(({ value }) => value) ? (
        <Card variant="flat" style={s.favoriteCard}>
          {favorites.map(({ label, value, icon }) =>
            value ? (
              <View key={label} style={[s.favorite, { flexBasis: 104 * fontScale }]}>
                <Ionicons name={icon} size={18} color={colors.primary} accessible={false} />
                <Text style={s.secondary}>{label}</Text>
                <Text style={s.favoriteValue}>{value}</Text>
              </View>
            ) : null,
          )}
        </Card>
      ) : null}
      {profile.mutualGroups.length ? (
        <View style={{ gap: space.sm, paddingVertical: space.md }}>
          <Text style={s.secondary} accessibilityRole="header">
            Mutual groups
          </Text>
          {profile.mutualGroups.map((g) => (
            <ProfileRow
              key={g.id}
              title={g.name}
              icon="people-outline"
              onPress={() => router.push({ pathname: '/groups/[id]', params: { id: g.id } })}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}
export function ProfileRow({
  title,
  subtitle,
  icon,
  onPress,
  disabled,
  tone = 'normal',
  loading = false,
}: {
  title: string;
  subtitle?: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress(): void;
  disabled?: boolean;
  tone?: 'normal' | 'accent' | 'quiet';
  loading?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!disabled, busy: loading }}
      style={({ pressed }) => [s.row, pressed && { opacity: 0.65 }, disabled && { opacity: 0.5 }]}
    >
      <View style={s.icon}>
        <Ionicons name={icon} size={21} color={tone === 'accent' ? colors.primary : colors.muted} />
      </View>
      <View style={s.rowContent}>
        <View style={s.labels}>
          <Text
            style={[
              s.rowTitle,
              tone === 'accent' && { color: colors.primary },
              tone === 'quiet' && { color: colors.muted },
            ]}
          >
            {title}
          </Text>
          {subtitle ? <Text style={s.secondary}>{subtitle}</Text> : null}
        </View>
        {loading ? (
          <ActivityIndicator color={colors.primary} />
        ) : tone === 'normal' ? (
          <Ionicons name="chevron-forward" size={16} color={colors.muted} />
        ) : null}
      </View>
    </Pressable>
  );
}
const s = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.xs, gap: space.md },
  identity: { flex: 1, minWidth: 0, gap: space.xs },
  avatarFrame: {
    padding: space.xs,
    borderRadius: radius.pill,
    backgroundColor: profileTheme.avatarBacking,
  },
  name: { ...type.heading, color: colors.text },
  username: { ...type.caption, color: colors.muted },
  stats: { ...type.caption, fontFamily: fonts.medium, color: colors.text },
  favorites: { gap: space.md },
  favoriteCard: {
    backgroundColor: profileTheme.surface,
    borderRadius: radius.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.md,
    padding: space.md,
  },
  favorite: { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: space.xs },
  labels: { flex: 1, gap: space.xs },
  favoriteValue: { ...type.body, fontFamily: fonts.medium, color: colors.text },
  secondary: { ...type.caption, color: colors.muted },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 60,
    paddingLeft: space.lg,
  },
  icon: { width: 26, alignItems: 'center' },
  rowContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 60,
    paddingVertical: space.md,
    paddingRight: space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowTitle: { fontSize: 16, lineHeight: 23, fontWeight: '500', color: colors.text },
});
