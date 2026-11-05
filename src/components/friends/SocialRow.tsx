import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, MIN_TARGET, friendsTheme, radius, space } from '../theme';
import { Avatar } from '../Avatar';
import type { AvatarRef } from '@shared/api/avatars.ts';

/** Optional metadata is presentation-only; rows never load conversation/profile data. */
export function SocialRow({
  title,
  subtitle,
  leading,
  actions,
  metadata,
  onPress,
}: {
  title: string;
  subtitle?: string;
  leading: ReactNode;
  actions?: ReactNode;
  metadata?: ReactNode;
  onPress?: () => void;
}) {
  const content = (
    <>
      {leading}
      <View style={s.labels}>
        <View style={s.titleLine}>
          <Text style={s.name}>{title}</Text>
          {metadata}
        </View>
        {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
      </View>
    </>
  );
  return (
    <View>
      <View style={s.row}>
        {onPress ? (
          <Pressable
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
            style={({ pressed }) => [s.main, pressed && s.pressed]}
          >
            {content}
          </Pressable>
        ) : (
          <View style={s.main}>{content}</View>
        )}
        {actions ? <View style={s.actions}>{actions}</View> : null}
      </View>
      <View style={s.separator} />
    </View>
  );
}
export function SocialIdentity({
  name,
  uri,
  size = 60,
  userId,
  avatarRef,
  group = false,
}: {
  name: string;
  group?: boolean;
  uri?: string | null;
  size?: number;
  userId?: string;
  avatarRef?: AvatarRef | null;
}) {
  return (
    <Avatar
      name={name}
      uri={uri}
      size={size}
      variant="social"
      userId={group ? undefined : userId}
      avatarRef={group ? undefined : avatarRef}
    />
  );
}

export function SocialAction({
  icon,
  label,
  onPress,
  tone = 'normal',
  treatment = 'plain',
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress(): void;
  tone?: 'normal' | 'quiet' | 'accent';
  treatment?: 'plain' | 'message';
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        s.iconTarget,
        treatment === 'message' && s.message,
        pressed && s.pressed,
      ]}
    >
      <Ionicons
        name={icon}
        size={tone === 'quiet' ? 18 : 22}
        color={tone === 'quiet' ? colors.muted : tone === 'accent' ? colors.primary : colors.text}
      />
    </Pressable>
  );
}
export function SocialBusy() {
  return (
    <View style={s.iconTarget}>
      <ActivityIndicator color={colors.primary} accessibilityLabel="Opening conversation" />
    </View>
  );
}
export function SocialSectionTitle({ title, count }: { title: string; count?: number }) {
  return (
    <View style={s.sectionHead}>
      <Text style={s.sectionTitle} accessibilityRole="header">
        {title}
      </Text>
      {count ? <Text style={s.count}>{count}</Text> : null}
    </View>
  );
}
/** Pending counts only: this never represents unread conversations. */
export function RequestsEntry({
  count,
  loading,
  error,
  onPress,
}: {
  count: number;
  loading: boolean;
  error: string | null;
  onPress(): void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Requests, ${count} pending${loading ? ', loading group invitations' : ''}${error ? `, ${error}` : ''}`}
      style={({ pressed }) => [s.requests, pressed && s.pressed]}
    >
      <Ionicons name="person-add-outline" size={21} color={colors.primary} />
      <View style={s.requestLabels}>
        <Text style={s.requestTitle}>Requests</Text>
        {error ? <Text style={s.subtitle}>{error}</Text> : null}
      </View>
      {loading ? <ActivityIndicator size="small" color={colors.muted} /> : null}
      {count > 0 ? (
        <View style={s.requestBadge}>
          <Text style={s.requestCount}>{count}</Text>
        </View>
      ) : null}
      <Ionicons name="chevron-forward" size={16} color={colors.muted} />
    </Pressable>
  );
}
const s = StyleSheet.create({
  requests: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 56,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    backgroundColor: friendsTheme.surface,
  },
  requestLabels: { flex: 1, gap: space.xs },
  requestTitle: { fontSize: 15, lineHeight: 22, fontWeight: '500', color: colors.text },
  requestBadge: {
    minWidth: 24,
    minHeight: 24,
    paddingHorizontal: space.sm,
    borderRadius: radius.pill,
    backgroundColor: friendsTheme.message,
    alignItems: 'center',
    justifyContent: 'center',
  },
  requestCount: { fontSize: 13, lineHeight: 20, fontWeight: '600', color: colors.primary },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 100,
    paddingVertical: space.lg + space.xs,
  },
  main: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    minHeight: MIN_TARGET,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 160,
    minWidth: 120,
  },
  labels: { flex: 1, minWidth: 0, gap: space.xs },
  titleLine: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  name: { flex: 1, fontSize: 19, lineHeight: 26, fontWeight: '600', color: colors.text },
  subtitle: { fontSize: 14, lineHeight: 20, color: colors.muted },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', flexShrink: 0 },
  separator: {
    marginLeft: 60 + space.lg,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  message: { backgroundColor: friendsTheme.message, borderRadius: radius.md },
  iconTarget: {
    minWidth: MIN_TARGET,
    minHeight: MIN_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  sectionTitle: { fontSize: 18, lineHeight: 25, fontWeight: '600', color: colors.text },
  count: { fontSize: 13, lineHeight: 18, fontWeight: '600', color: colors.primary },
  pressed: { opacity: 0.65 },
});
