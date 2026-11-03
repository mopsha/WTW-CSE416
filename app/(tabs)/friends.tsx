import { GroupInvitations } from '@/components/GroupInvitations';
// Friends, in the live-demo style: add someone by the email they sign in with, answer requests,
// and see who you're friends with. Every write goes through the API (src/lib/api.ts).
// Joining a Pick still happens by code; inviting friends to a Pick comes later.
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';

import type { FriendPerson, FriendsList } from '@shared/api/friends.ts';

import {
  Avatar,
  Button,
  Card,
  colors,
  ErrorState,
  fonts,
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
import {
  HeaderAction,
  ListRow,
  QuietEmpty,
  SectionHeading,
  Segments,
  Sheet,
  TabHeading,
} from '@/components/TabUi';
import { useSession } from '@/hooks/useAuth';
import { queries } from '@/lib/queries';
import { memberCountLabel, newGroupPickRoute, type GroupSummary } from '@/lib/groups';

const nameOf = (p: FriendPerson) => p.displayName ?? 'WTW friend';

/** "just now", "45m ago", "3h ago", "Oct 11". */
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

export default function FriendsScreen() {
  const session = useSession();
  const [tab, setTab] = useState<'friends' | 'groups'>('friends');
  const [adding, setAdding] = useState(false);
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [list, setList] = useState<FriendsList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const action = useAction();
  const openingMessage = useRef(false);

  const load = useCallback(async () => {
    try {
      setList(await api.listFriends());
      setLoadError(null);
    } catch (e) {
      setLoadError(messageOf(e));
    }
    try {
      setGroups(await queries.listMyGroups(session.user.id));
      setGroupError(null);
    } catch (e) {
      setGroupError(messageOf(e));
    }
  }, [session.user.id]);

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

  const empty = list && !list.friends.length && !list.incoming.length;

  return (
    <Screen
      edges={['top', 'left', 'right']}
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        void load().finally(() => setRefreshing(false));
      }}
    >
      <TabHeading
        title="Friends"
        right={
          <HeaderAction
            icon="person-add-outline"
            label="Add a friend"
            onPress={() => setAdding(true)}
          />
        }
      />
      <Segments
        options={[
          { value: 'friends', label: 'Friends' },
          { value: 'groups', label: 'Groups' },
        ]}
        value={tab}
        onChange={setTab}
        label="Friends or groups"
      />
      <GroupInvitations
        key={session.user.id}
        refreshing={refreshing}
        onAccepted={() => void load()}
      />
      {action.error ? <ErrorState message={action.error} /> : null}
      {tab === 'friends' ? (
        <>
          {loadError ? <ErrorState message={loadError} onRetry={() => void load()} /> : null}
          {list === null && !loadError ? (
            <ActivityIndicator color={colors.primary} accessibilityLabel="Loading your friends" />
          ) : null}
          {list?.incoming.length ? (
            <View style={styles.group}>
              <SectionHeading title="Friend requests" badge={list.incoming.length} />
              {list.incoming.map((p) => (
                <View key={p.userId} style={styles.row}>
                  <Avatar name={nameOf(p)} neutral size={46} />
                  <View style={styles.who}>
                    <Text style={styles.name}>{nameOf(p)}</Text>
                    <Text style={styles.caption}>Request sent by email</Text>
                  </View>
                  <Button
                    label=""
                    icon="close-outline"
                    variant="secondary"
                    disabled={!!action.busy}
                    loading={action.busy === `remove:${p.userId}`}
                    style={styles.requestAction}
                    accessibilityLabel={`Decline ${nameOf(p)}'s friend request`}
                    onPress={() => void act(`remove:${p.userId}`, () => api.removeFriend(p.userId))}
                  />
                  <Button
                    label=""
                    icon="checkmark-outline"
                    disabled={!!action.busy}
                    loading={action.busy === `accept:${p.userId}`}
                    style={styles.requestAction}
                    accessibilityLabel={`Accept ${nameOf(p)}'s friend request`}
                    onPress={() => void act(`accept:${p.userId}`, () => api.acceptFriend(p.userId))}
                  />
                </View>
              ))}
            </View>
          ) : null}
          {list?.friends.length ? (
            <View style={styles.group}>
              <SectionHeading title={`Your friends (${list.friends.length})`} />
              <View>
                {list.friends.map((p) => (
                  <ListRow
                    key={p.userId}
                    onPress={() =>
                      router.push({ pathname: '/users/[id]', params: { id: p.userId } })
                    }
                    title={nameOf(p)}
                    subtitle={`Friends since ${day(p.since)}`}
                    leading={<Avatar name={nameOf(p)} neutral size={44} />}
                    right={
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        {action.busy === `message:${p.userId}` ? (
                          <ActivityIndicator
                            color={colors.primary}
                            accessibilityLabel="Opening conversation"
                          />
                        ) : (
                          <HeaderAction
                            icon="chatbubble-outline"
                            label={`Message ${nameOf(p)}`}
                            onPress={() => {
                              if (openingMessage.current) return;
                              openingMessage.current = true;
                              void action
                                .run(`message:${p.userId}`, async () => {
                                  const conversation = await api.openDirectConversation(p.userId);
                                  router.push({
                                    pathname: '/messages/[id]',
                                    params: { id: conversation.id },
                                  });
                                })
                                .finally(() => {
                                  openingMessage.current = false;
                                });
                            }}
                          />
                        )}
                        <HeaderAction
                          icon="ellipsis-horizontal"
                          label={`Remove ${nameOf(p)} from friends`}
                          onPress={() => void remove(p)}
                        />
                      </View>
                    }
                  />
                ))}
              </View>
            </View>
          ) : null}
          {empty ? (
            <QuietEmpty
              icon="people-outline"
              title="No friends here yet"
              body="Add a friend by email. When they accept, they’ll show up here."
            />
          ) : null}
        </>
      ) : (
        <>
          <SectionHeading
            title="Your groups"
            right={
              <Button label="Manage groups" variant="link" onPress={() => router.push('/groups')} />
            }
          />
          {groupError ? <ErrorState message={groupError} onRetry={() => void load()} /> : null}
          {groups === null && !groupError ? (
            <ActivityIndicator color={colors.primary} accessibilityLabel="Loading your groups" />
          ) : null}
          {groups?.map((g) => (
            <ListRow
              key={g.id}
              title={g.name}
              subtitle={memberCountLabel(g.memberCount)}
              leading={<Avatar name={g.name} neutral size={46} />}
              onPress={() => router.push({ pathname: '/groups/[id]', params: { id: g.id } })}
              right={
                <Button
                  label="Start"
                  variant="link"
                  accessibilityLabel={`Start a Pick with ${g.name}`}
                  onPress={() => router.push(newGroupPickRoute(g))}
                />
              }
            />
          ))}
          {groups?.length === 0 ? (
            <QuietEmpty
              icon="people-outline"
              title="Your crew goes here"
              body="Create a group for the people you pick with."
            />
          ) : null}
          <Button
            label="Create a group"
            variant="secondary"
            icon="add-outline"
            onPress={() => router.push('/groups')}
          />
        </>
      )}
      <Sheet visible={adding} title="Add a friend" onClose={() => setAdding(false)}>
        <AddFriendCard onAdded={() => void load()} />
      </Sheet>
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
  group: { gap: space.md, marginTop: space.md },
  section: {
    ...type.caption,
    fontFamily: fonts.bold,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  highlight: { borderColor: colors.primary },
  listCard: { paddingVertical: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 64 },
  requestAction: { width: 48 },
  who: { flex: 1, gap: 2 },
  name: { ...type.body, fontFamily: fonts.semibold, color: colors.text },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md },
  actionButton: { flex: 1 },
});
