import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { MemberMenu } from '../MemberMenu';
import { MenuItem, menuStyles } from '../HostMenu';
import { Sheet } from '../TabUi';
import { HangAttendees } from './HangAttendees';
import type { HangPost, HangStatus } from '@shared/api/hang.ts';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { haptic } from '@/lib/haptics';
import { Avatar } from '@/components';
import { colors, MIN_TARGET, picksTheme, radius, space } from '@/components/theme';

/** Presentation only: HangCard retains fetching, expiry, eligibility and mutations. */
export function HangInvitation({
  post,
  userId,
  busy,
  disabled = false,
  pending: mutationPending = false,
  singlePost = false,
  onRespond,
  onStart,
}: {
  post: HangPost;
  userId: string | undefined;
  busy: string | null;
  disabled?: boolean;
  pending?: boolean;
  singlePost?: boolean;
  onRespond(status: HangStatus): void;
  onStart(): void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const startAfterDismiss = useRef(false);
  const isHost = post.authorId === userId;
  const openProfile = (id: string) => {
    if (id === userId && !singlePost) {
      router.navigate('/(tabs)/profile');
      return;
    }
    // A standalone Hang stays under the profile so Back returns to the Hang.
    router.navigate({
      pathname: '/users/[id]',
      params: id === userId ? { id } : { id, hangId: post.id },
    });
  };
  const author = post.authorName ?? (isHost ? 'You' : 'A friend');
  const canStart =
    isHost &&
    post.canStartPick === true &&
    !!post.downCount &&
    !disabled &&
    !mutationPending &&
    busy === null;

  return (
    <View style={s.invitation}>
      <View style={s.authorRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open ${author}’s profile`}
          onPress={() => openProfile(post.authorId)}
          style={s.authorIdentity}
        >
          <Avatar name={author} userId={post.authorId} size={40} />
          <View style={s.authorDetails}>
            <Text style={s.author}>{author}</Text>
            <Text style={s.caption}>
              {new Date(post.startsAt).toLocaleString(undefined, {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </Text>
          </View>
        </Pressable>
        {canStart ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Hang options"
            onPress={() => setMenuOpen(true)}
            style={menuStyles.trigger}
          >
            <Ionicons name="ellipsis-horizontal" color={colors.muted} size={20} />
          </Pressable>
        ) : null}
        {userId && !isHost ? <MemberMenu userId={post.authorId} name={author} /> : null}
      </View>
      <Text style={s.activity}>{post.activity}</Text>
      <View style={s.responses}>
        {(['down', 'maybe', 'cant'] as const).map((status) => {
          const label = status === 'down' ? "I'm in" : status === 'maybe' ? 'Maybe' : 'Can’t';
          const selected = post.myStatus === status;
          const pending = busy === `${post.id}-${status}`;
          return (
            <Pressable
              key={status}
              onPress={() => {
                haptic.tap();
                onRespond(status);
              }}
              disabled={disabled || busy !== null}
              accessibilityRole="button"
              accessibilityLabel={`${label}, ${post.activity}`}
              accessibilityState={{
                selected,
                disabled: disabled || busy !== null,
                busy: pending || (mutationPending && selected),
              }}
              style={({ pressed }) => [s.response, selected && s.selected, pressed && s.pressed]}
            >
              {pending ? (
                <ActivityIndicator color={selected ? colors.bg : colors.text} />
              ) : (
                <Text style={[s.responseText, selected && s.selectedText]}>{label}</Text>
              )}
            </Pressable>
          );
        })}
      </View>
      <HangAttendees post={post} onOpenProfile={openProfile} />
      <Sheet
        visible={menuOpen && canStart}
        title="Hang options"
        onClose={() => setMenuOpen(false)}
        onDismiss={() => {
          const requested = startAfterDismiss.current;
          startAfterDismiss.current = false;
          setMenuOpen(false);
          if (requested && canStart && Date.parse(post.expiresAt) > Date.now()) onStart();
        }}
      >
        {menuOpen && canStart ? (
          <MenuItem
            icon="flame-outline"
            label="Start a Pick"
            hint="Choose what to do with people who are down"
            onPress={() => {
              setMenuOpen(false);
              startAfterDismiss.current = true;
            }}
          />
        ) : null}
      </Sheet>
    </View>
  );
}
const s = StyleSheet.create({
  invitation: {
    backgroundColor: picksTheme.colors.invitation,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.sm,
  },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  authorIdentity: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: MIN_TARGET,
  },
  authorDetails: { flex: 1, minWidth: 0 },
  author: { ...picksTheme.secondary, fontWeight: '600', color: colors.text },
  caption: { ...picksTheme.secondary, color: colors.muted },
  activity: {
    ...picksTheme.ui,
    fontSize: 22,
    lineHeight: 29,
    fontWeight: '600',
    color: colors.text,
  },
  responses: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: picksTheme.colors.invitationControl,
    borderRadius: radius.md,
    padding: space.xs,
    gap: space.xs,
  },
  response: {
    flex: 1,
    flexBasis: 72,
    minHeight: MIN_TARGET,
    paddingVertical: space.sm,
    paddingHorizontal: space.xs,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  responseText: {
    ...picksTheme.secondary,
    fontWeight: '500',
    color: colors.text,
    textAlign: 'center',
  },
  selected: { backgroundColor: colors.primary },
  selectedText: { color: colors.bg, fontWeight: '600' },
  pressed: { opacity: 0.75 },
});
