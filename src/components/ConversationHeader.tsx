import type { ReactNode } from 'react';
import { SocialIdentity } from './friends/SocialRow';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { IconButton } from '@/components';
import { colors, MIN_TARGET, space } from './theme';
export function ConversationHeader({
  name,
  uri,
  subtitle,
  onPress,
  loading = false,
  unavailable = false,
  right,
}: {
  name?: string;
  uri?: string | null;
  subtitle?: string;
  onPress?: () => void;
  loading?: boolean;
  unavailable?: boolean;
  right?: ReactNode;
}) {
  const identity = (
    <>
      {name ? (
        <SocialIdentity name={name} uri={uri} size={40} />
      ) : loading ? (
        <ActivityIndicator color={colors.muted} accessibilityLabel="Loading conversation" />
      ) : null}
      <View style={s.labels}>
        <Text style={s.name}>
          {name ??
            (unavailable
              ? 'Conversation unavailable'
              : loading
                ? 'Loading conversation…'
                : 'Conversation')}
        </Text>
        {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
      </View>
    </>
  );
  return (
    <View style={s.header}>
      <IconButton
        icon="chevron-back"
        accessibilityLabel="Back"
        onPress={() => {
          if (router.canGoBack()) router.back();
          else router.replace('/');
        }}
      />
      {onPress && name ? (
        <Pressable
          style={s.identity}
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={name}
        >
          {identity}
        </Pressable>
      ) : (
        <View style={s.identity}>{identity}</View>
      )}
      {right}
    </View>
  );
}
const s = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 60,
    gap: space.xs,
    paddingHorizontal: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  identity: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: MIN_TARGET,
    gap: space.md,
    paddingVertical: space.xs,
  },
  labels: { flex: 1, gap: 2 },
  name: { fontSize: 17, lineHeight: 23, fontWeight: '600', color: colors.text },
  subtitle: { fontSize: 12, lineHeight: 17, color: colors.muted },
});
