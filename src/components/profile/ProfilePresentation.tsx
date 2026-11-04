import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { UserProfile } from '@shared/api/userProfiles.ts';
import { Avatar } from '../Avatar';
import { colors, fonts, profileTheme, space } from '../theme';

export function ProfileHero({ name, profile }: { name: string; profile: UserProfile | null }) {
  return (
    <View style={s.hero}>
      <View style={s.avatarFrame}>
        <Avatar name={name} uri={profile?.avatarUrl} neutral size={96} />
      </View>
      <View style={s.identity}>
        <Text style={s.name}>{name}</Text>
        {profile?.username ? <Text style={s.username}>@{profile.username}</Text> : null}
        {profile?.metadataVisible ? (
          <View style={s.stats}>
            <View
              style={s.stat}
              accessible
              accessibilityLabel={`${profile.friendsCount ?? 0} friends`}
            >
              <Text style={s.number}>{profile.friendsCount ?? 0}</Text>
              <Text style={s.statLabel}>friends</Text>
            </View>
            <View style={s.statDivider} />
            <View
              style={s.stat}
              accessible
              accessibilityLabel={`${profile.groupsCount ?? 0} groups`}
            >
              <Text style={s.number}>{profile.groupsCount ?? 0}</Text>
              <Text style={s.statLabel}>groups</Text>
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}
export function ProfileFavorites({ profile }: { profile: UserProfile }) {
  if (!profile.metadataVisible)
    return <Text style={s.secondary}>Profile details are private.</Text>;
  if (!profile.favoriteCuisine && !profile.favoriteActivity && !profile.mutualGroups.length)
    return null;
  return (
    <View style={s.favorites}>
      {profile.favoriteCuisine ? (
        <View style={s.favorite}>
          <Ionicons name="restaurant-outline" size={19} color={colors.primary} />
          <View style={s.labels}>
            <Text style={s.secondary}>Favorite cuisine</Text>
            <Text style={s.favoriteValue}>{profile.favoriteCuisine}</Text>
          </View>
        </View>
      ) : null}
      {profile.favoriteActivity ? (
        <View style={s.favorite}>
          <Ionicons name="sparkles-outline" size={19} color={colors.primary} />
          <View style={s.labels}>
            <Text style={s.secondary}>Favorite activity</Text>
            <Text style={s.favoriteValue}>{profile.favoriteActivity}</Text>
          </View>
        </View>
      ) : null}
      {profile.mutualGroups.length ? (
        <View style={{ gap: space.sm, paddingVertical: space.md }}>
          <Text style={s.secondary}>Mutual groups</Text>
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
  hero: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.lg, gap: space.lg },
  identity: { flex: 1, minWidth: 0, gap: space.xs },
  avatarFrame: {
    padding: space.xs,
    borderRadius: 64,
    backgroundColor: profileTheme.avatarBacking,
  },
  name: {
    flexShrink: 1,
    fontFamily: fonts.bold,
    fontSize: 22,
    lineHeight: 29,
    letterSpacing: -0.5,
    color: colors.text,
  },
  username: {
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '500',
    color: colors.text,
  },
  stats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-start',
    marginTop: space.sm,
    gap: space.lg,
  },
  stat: { alignItems: 'flex-start', minWidth: 60, gap: 2 },
  number: { fontSize: 21, lineHeight: 27, fontWeight: '700', color: colors.text },
  statLabel: { fontSize: 14, lineHeight: 20, color: colors.muted },
  statDivider: { width: StyleSheet.hairlineWidth, height: 30, backgroundColor: colors.border },
  favorites: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: space.xl,
    rowGap: space.sm,
  },
  favorite: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.xs,
    flexGrow: 1,
    flexBasis: 140,
  },
  labels: { flex: 1, gap: space.xs },
  favoriteValue: { fontSize: 15, lineHeight: 22, fontWeight: '500', color: colors.text },
  secondary: { fontSize: 13, lineHeight: 19, color: colors.muted },
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
