// Friends, in the live-demo style: add someone by the email they sign in with, answer requests,
// and see who you're friends with. Every write goes through the API (src/lib/api.ts).
// Joining a Pick still happens by code; inviting friends to a Pick comes later.
import { useFocusEffect } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';

import type { FriendPerson, FriendsList } from '@shared/api/friends.ts';

import {
  Avatar,
  Button,
  Card,
  colors,
  EmptyState,
  ErrorState,
  fonts,
  IconButton,
  MIN_TARGET,
  radius,
  Screen,
  space,
  type,
} from '@/components';
import { GradientButton } from '@/components/GradientButton';
import { useAction } from '@/hooks/useAction';
import { api } from '@/lib/api';
import { USE_MOCK } from '@/lib/config';
import { confirmAction } from '@/lib/confirm';
import { messageOf } from '@/lib/errors';
import { haptic } from '@/lib/haptics';

const nameOf = (p: FriendPerson) => p.displayName ?? 'WTW friend';

/** "just now", "45m ago", "3h ago", "Oct 11". */
function when(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '';
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  if (min < 60 * 24) return `${Math.floor(min / 60)}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** "today" or "Oct 11", for "Friends since …". */
function day(iso: string): string {
  const d = new Date(iso);
  if (d.toDateString() === new Date().toDateString()) return 'today';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function AddFriendCard({ onAdded }: { onAdded: () => void }) {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const { busy, error, run, clearError } = useAction();

  const submit = async () => {
    if (busy || !email.trim()) return;
    setDone(null);
    let message = '';
    const ok = await run('add', async () => {
      await api.addFriend(email.trim());
      message = 'If they’re on WTW, they’ll see your request.';
    });
    if (!ok) return;
    haptic.success();
    setEmail('');
    setDone(message);
    onAdded();
  };

  return (
    <Card>
      <Text style={styles.cardTitle} accessibilityRole="header">
        Add a friend
      </Text>
      <Text style={styles.caption}>Use the email they sign in to WTW with.</Text>
      <TextInput
        style={styles.input}
        value={email}
        onChangeText={(t) => {
          setEmail(t);
          if (error) clearError();
          if (done) setDone(null);
        }}
        placeholder="friend@stonybrook.edu"
        placeholderTextColor={colors.muted}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        spellCheck={false}
        maxLength={254}
        returnKeyType="send"
        onSubmitEditing={() => void submit()}
        editable={!busy}
        accessibilityLabel="Friend's email"
        accessibilityHint="The email address your friend signs in with"
      />
      <GradientButton
        label="Send request"
        onPress={() => void submit()}
        loading={!!busy}
        disabled={!email.trim()}
        style={styles.send}
      />
      {error ? (
        <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      {done ? (
        <Text style={styles.done} accessibilityLiveRegion="polite">
          {done}
        </Text>
      ) : null}
      {USE_MOCK ? (
        <Text style={styles.caption}>
          Demo mode: any email works; one starting with nobody@ has no account.
        </Text>
      ) : null}
    </Card>
  );
}

function PersonRow({
  person,
  detail,
  children,
}: {
  person: FriendPerson;
  detail: string;
  children?: ReactNode;
}) {
  return (
    <View style={styles.row}>
      <Avatar name={nameOf(person)} size={44} />
      <View style={styles.who} accessible accessibilityLabel={`${nameOf(person)}, ${detail}`}>
        <Text style={styles.name} numberOfLines={1}>
          {nameOf(person)}
        </Text>
        <Text style={styles.caption} numberOfLines={1}>
          {detail}
        </Text>
      </View>
      {children}
    </View>
  );
}

function Section({ title, count }: { title: string; count: number }) {
  return (
    <Text style={styles.section} accessibilityRole="header">
      {title} · {count}
    </Text>
  );
}

export default function FriendsScreen() {
  const [list, setList] = useState<FriendsList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const action = useAction();

  const load = useCallback(async () => {
    try {
      setList(await api.listFriends());
      setLoadError(null);
    } catch (e) {
      setLoadError(messageOf(e));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const act = async (key: string, fn: () => Promise<unknown>) => {
    if (await action.run(key, fn)) {
      haptic.success();
      await load();
    }
  };

  const remove = async (p: FriendPerson) => {
    const ok = await confirmAction({
      title: `Remove ${nameOf(p)}?`,
      message: 'You can add each other again any time.',
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (ok) await act(`remove:${p.userId}`, () => api.removeFriend(p.userId));
  };

  const empty = list && !list.friends.length && !list.incoming.length && !list.outgoing.length;

  return (
    <Screen
      title="Friends"
      subtitle={list?.friends.length ? `${list.friends.length} on WTW 👋` : undefined}
      edges={['top', 'left', 'right']}
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        void load().finally(() => setRefreshing(false));
      }}
    >
      <AddFriendCard onAdded={() => void load()} />

      {action.error ? <ErrorState message={action.error} /> : null}

      {list === null && loadError ? (
        <ErrorState variant="full" message={loadError} onRetry={() => void load()} />
      ) : null}
      {list === null && !loadError ? (
        <ActivityIndicator
          style={styles.loading}
          size="large"
          color={colors.primary}
          accessibilityLabel="Loading your friends"
        />
      ) : null}
      {list && loadError ? <ErrorState message={loadError} onRetry={() => void load()} /> : null}

      {list?.incoming.length ? (
        <View style={styles.group}>
          <Section title="Requests" count={list.incoming.length} />
          {list.incoming.map((p) => (
            <Card key={p.userId} style={styles.highlight}>
              <PersonRow person={p} detail={`Wants to be friends · ${when(p.since)}`} />
              <View style={styles.actions}>
                <Button
                  label="Accept"
                  variant="secondary"
                  icon="checkmark"
                  loading={action.busy === `accept:${p.userId}`}
                  disabled={!!action.busy}
                  accessibilityLabel={`Accept ${nameOf(p)}'s friend request`}
                  onPress={() => void act(`accept:${p.userId}`, () => api.acceptFriend(p.userId))}
                  style={styles.actionButton}
                />
                <Button
                  label="Decline"
                  variant="link"
                  loading={action.busy === `remove:${p.userId}`}
                  disabled={!!action.busy}
                  accessibilityLabel={`Decline ${nameOf(p)}'s friend request`}
                  onPress={() => void act(`remove:${p.userId}`, () => api.removeFriend(p.userId))}
                />
              </View>
            </Card>
          ))}
        </View>
      ) : null}

      {list?.friends.length ? (
        <View style={styles.group}>
          <Section title="Friends" count={list.friends.length} />
          <Card style={styles.listCard}>
            {list.friends.map((p, i) => (
              <View key={p.userId} style={i > 0 && styles.divider}>
                <PersonRow person={p} detail={`Friends since ${day(p.since)}`}>
                  <IconButton
                    icon="person-remove-outline"
                    accessibilityLabel={`Remove ${nameOf(p)} from friends`}
                    onPress={() => void remove(p)}
                  />
                </PersonRow>
              </View>
            ))}
          </Card>
        </View>
      ) : null}

      {list?.outgoing.length ? (
        <View style={styles.group}>
          <Section title="Sent" count={list.outgoing.length} />
          <Card style={styles.listCard}>
            {list.outgoing.map((p, i) => (
              <View key={p.userId} style={i > 0 && styles.divider}>
                <PersonRow person={p} detail={`Request sent · ${when(p.since)}`}>
                  <Button
                    label="Cancel"
                    variant="link"
                    loading={action.busy === `remove:${p.userId}`}
                    disabled={!!action.busy}
                    accessibilityLabel={`Cancel your friend request to ${nameOf(p)}`}
                    onPress={() => void act(`remove:${p.userId}`, () => api.removeFriend(p.userId))}
                  />
                </PersonRow>
              </View>
            ))}
          </Card>
        </View>
      ) : null}

      {empty ? (
        <EmptyState
          emoji="👋"
          title="No friends here yet"
          body="Add a friend by email above. When they accept, they'll show up here."
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  cardTitle: { ...type.heading, color: colors.text },
  caption: { ...type.caption, color: colors.muted },
  input: {
    minHeight: MIN_TARGET + 4,
    marginTop: space.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: 20,
    fontFamily: fonts.medium,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.cardHi,
  },
  send: { marginTop: space.md },
  error: { ...type.caption, color: colors.danger, marginTop: space.sm },
  done: { ...type.caption, color: colors.yes, marginTop: space.sm },
  loading: { marginTop: 40 },
  group: { gap: space.sm },
  section: {
    ...type.caption,
    fontFamily: fonts.bold,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  highlight: { borderColor: colors.primary },
  listCard: { paddingVertical: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: MIN_TARGET + 12 },
  who: { flex: 1, gap: 2 },
  name: { ...type.body, fontFamily: fonts.semibold, color: colors.text },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md },
  actionButton: { flex: 1 },
});
