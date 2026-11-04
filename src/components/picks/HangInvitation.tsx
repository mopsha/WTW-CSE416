import type { HangPost, HangStatus } from '@shared/api/hang.ts';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { haptic } from '@/lib/haptics';
import { Avatar, Button } from '@/components';
import { colors, MIN_TARGET, picksTheme, radius, space } from '@/components/theme';

/** Presentation only: HangCard retains fetching, expiry, eligibility and mutations. */
export function HangInvitation({
  post,
  userId,
  busy,
  onRespond,
  onStart,
}: {
  post: HangPost;
  userId: string | undefined;
  busy: string | null;
  onRespond(status: HangStatus): void;
  onStart(): void;
}) {
  const author = post.authorId === userId ? 'You' : (post.authorName ?? 'A friend');
  return (
    <View style={s.invitation}>
      <View style={s.authorRow}>
        <Avatar name={author} userId={post.authorId} neutral size={36} />
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
        <Text style={s.count}>{post.downCount ?? 0} down</Text>
      </View>
      <Text style={s.activity}>{post.activity}</Text>
      <View style={s.responses}>
        {(['down', 'maybe', 'cant'] as const).map((status) => {
          const label = status === 'down' ? 'Down' : status === 'maybe' ? 'Maybe' : 'Can’t';
          const selected = post.myStatus === status;
          const pending = busy === `${post.id}-${status}`;
          return (
            <Pressable
              key={status}
              onPress={() => {
                haptic.tap();
                onRespond(status);
              }}
              disabled={busy !== null}
              accessibilityRole="button"
              accessibilityLabel={`${label}, ${post.activity}`}
              accessibilityState={{ selected, disabled: busy !== null, busy: pending }}
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
      {post.authorId === userId ? (
        <View style={s.host}>
          <Text style={s.caption}>
            Only people who answer Down join. If you’re not down, one of them hosts.
          </Text>
          <Button
            label="Let’s Pick"
            variant="secondary"
            style={s.hostAction}
            disabled={!post.downCount || busy !== null}
            onPress={onStart}
          />
        </View>
      ) : null}
    </View>
  );
}
const s = StyleSheet.create({
  invitation: {
    backgroundColor: picksTheme.colors.invitation,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.md,
  },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  authorDetails: { flex: 1, minWidth: 100 },
  author: { ...picksTheme.secondary, fontWeight: '600', color: colors.text },
  caption: { ...picksTheme.secondary, color: colors.muted },
  count: { ...picksTheme.secondary, color: colors.muted },
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
    padding: space.sm,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  responseText: { ...picksTheme.ui, fontWeight: '500', color: colors.text, textAlign: 'center' },
  selected: { backgroundColor: colors.primary },
  selectedText: { color: colors.bg, fontWeight: '600' },
  pressed: { opacity: 0.75 },
  host: { gap: space.md },
  hostAction: {
    backgroundColor: picksTheme.colors.invitationControl,
    borderWidth: 0,
    borderRadius: radius.md,
  },
});
