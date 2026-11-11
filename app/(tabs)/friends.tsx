import { UsernameFriendSearch } from '@/components/friends/UsernameFriendSearch';
import {
  RequestsEntry,
  SocialRow,
  SocialIdentity,
  SocialAction,
  SocialBusy,
  SocialSectionTitle,
} from '@/components/friends/SocialRow';
import { GroupInvitations } from '@/components/GroupInvitations';
// Friends: discover public usernames, answer requests,
// and see who you're friends with. Every write goes through the API (src/lib/api.ts).
// Joining a Pick still happens by code; inviting friends to a Pick comes later.
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, StyleSheet, Text, View } from 'react-native';

import type { FriendPerson, FriendsList } from '@shared/api/friends.ts';

import { Button, colors, ErrorState, fonts, MIN_TARGET, radius, Screen, space } from '@/components';
import { useAction } from '@/hooks/useAction';
import { api } from '@/lib/api';
import { confirmAction } from '@/lib/confirm';
import { messageOf } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { QuietEmpty, Segments, Sheet } from '@/components/TabUi';
import { useSession } from '@/hooks/useAuth';
import { queries } from '@/lib/queries';
import { memberCountLabel, newGroupPickRoute, type GroupSummary } from '@/lib/groups';

const nameOf = (p: FriendPerson) => p.displayName ?? 'WTW friend';

/** "today" or "Oct 11", for "Friends since …". */
function day(iso: string): string {
  const d = new Date(iso);
  if (d.toDateString() === new Date().toDateString()) return 'today';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function FriendsScreen() {
  const { requests } = useLocalSearchParams<{ requests?: string }>();
  const session = useSession();
  const [tab, setTab] = useState<'friends' | 'groups'>('friends');
  const [adding, setAdding] = useState(false);
  const [requestsOpen, setRequestsOpen] = useState(false);
  const handoff = useRef<{ kind: 'requests' } | { kind: 'profile'; id: string } | null>(null);
  useEffect(
    () => () => {
      handoff.current = null;
    },
    [session.user.id],
  );
  const finishHandoff = useCallback(() => {
    const target = handoff.current;
    handoff.current = null;
    if (target?.kind === 'requests') setRequestsOpen(true);
    else if (target?.kind === 'profile')
      router.push({ pathname: '/p/[id]', params: { id: target.id } });
  }, []);
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

  const empty = list && !list.friends.length;

  return (
    <Screen
      edges={['top', 'left', 'right']}
      contentStyle={styles.content}
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        void load().finally(() => setRefreshing(false));
      }}
    >
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          Friends
        </Text>
        <SocialAction
          icon="person-add-outline"
          label="Add a friend"
          tone="accent"
          onPress={() => setAdding(true)}
        />
      </View>
      <Segments
        variant="compact"
        options={[
          { value: 'friends', label: 'Friends' },
          { value: 'groups', label: 'Groups' },
        ]}
        value={tab}
        onChange={setTab}
        label="Friends or groups"
      />
      <GroupInvitations
        variant="compact"
        key={session.user.id}
        refreshing={refreshing}
        onAccepted={() => void load()}
        renderContainer={({ count, loading, error, content }) => (
          <>
            <RequestsEntry
              count={count + (list?.incoming.length ?? 0)}
              loading={loading}
              error={error}
              onPress={() => setRequestsOpen(true)}
            />
            <Sheet
              visible={!adding && (requestsOpen || requests === '1')}
              title="Requests"
              onClose={() => {
                setRequestsOpen(false);
                if (requests) router.setParams({ requests: undefined });
              }}
            >
              {action.error ? <ErrorState message={action.error} /> : null}
              {list?.incoming.length ? (
                <View style={styles.group}>
                  <SocialSectionTitle title="Friend requests" count={list.incoming.length} />
                  {list.incoming.map((p) => (
                    <SocialRow
                      key={p.userId}
                      title={nameOf(p)}
                      subtitle="Friend request"
                      leading={
                        <SocialIdentity
                          name={nameOf(p)}
                          userId={p.userId}
                          avatarRef={p.avatarRef}
                        />
                      }
                      actions={
                        <>
                          <Button
                            label=""
                            icon="close-outline"
                            variant="secondary"
                            disabled={!!action.busy}
                            loading={action.busy === `remove:${p.userId}`}
                            style={styles.requestAction}
                            accessibilityLabel={`Decline ${nameOf(p)}'s friend request`}
                            onPress={() =>
                              void act(`remove:${p.userId}`, () => api.removeFriend(p.userId))
                            }
                          />
                          <Button
                            label=""
                            icon="checkmark-outline"
                            disabled={!!action.busy}
                            loading={action.busy === `accept:${p.userId}`}
                            style={styles.requestAction}
                            accessibilityLabel={`Accept ${nameOf(p)}'s friend request`}
                            onPress={() =>
                              void act(`accept:${p.userId}`, () => api.acceptFriend(p.userId))
                            }
                          />
                        </>
                      }
                    />
                  ))}
                </View>
              ) : null}
              {content}
              {!loading &&
              !error &&
              !loadError &&
              list !== null &&
              count === 0 &&
              !list.incoming.length ? (
                <Text style={styles.caption}>No pending requests</Text>
              ) : null}
              {loadError ? <ErrorState message={loadError} onRetry={() => void load()} /> : null}
              {list === null && !loadError ? (
                <ActivityIndicator
                  color={colors.primary}
                  accessibilityLabel="Loading your friends"
                />
              ) : null}
            </Sheet>
          </>
        )}
      />
      {action.error && !requestsOpen ? <ErrorState message={action.error} /> : null}
      {tab === 'friends' ? (
        <>
          {loadError ? <ErrorState message={loadError} onRetry={() => void load()} /> : null}
          {list === null && !loadError ? (
            <ActivityIndicator color={colors.primary} accessibilityLabel="Loading your friends" />
          ) : null}
          {list?.friends.length ? (
            <View style={styles.group}>
              <SocialSectionTitle title={`Your friends (${list.friends.length})`} />
              <View>
                {list.friends.map((p) => (
                  <SocialRow
                    key={p.userId}
                    onPress={() =>
                      router.push({ pathname: '/users/[id]', params: { id: p.userId } })
                    }
                    title={nameOf(p)}
                    subtitle={`Friends since ${day(p.since)}`}
                    leading={
                      <SocialIdentity name={nameOf(p)} userId={p.userId} avatarRef={p.avatarRef} />
                    }
                    actions={
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        {action.busy === `message:${p.userId}` ? (
                          <SocialBusy />
                        ) : (
                          <SocialAction
                            icon="chatbubble-ellipses-outline"
                            tone="accent"
                            treatment="message"
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
                        <SocialAction
                          icon="ellipsis-horizontal"
                          tone="quiet"
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
              body="Add a friend by username. When they accept, they’ll show up here."
            />
          ) : null}
        </>
      ) : (
        <>
          <View style={styles.sectionHead}>
            <SocialSectionTitle title="Your groups" />
            <Button label="Manage groups" variant="link" onPress={() => router.push('/groups')} />
          </View>
          {groupError ? <ErrorState message={groupError} onRetry={() => void load()} /> : null}
          {groups === null && !groupError ? (
            <ActivityIndicator color={colors.primary} accessibilityLabel="Loading your groups" />
          ) : null}
          {groups?.map((g) => (
            <SocialRow
              key={g.id}
              title={g.name}
              subtitle={memberCountLabel(g.memberCount)}
              leading={<SocialIdentity name={g.name} group />}
              onPress={() => router.push({ pathname: '/groups/[id]', params: { id: g.id } })}
              actions={
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
            style={styles.createGroup}
            icon="add-outline"
            onPress={() => router.push('/groups')}
          />
        </>
      )}
      <Sheet
        visible={adding}
        title="Add a friend"
        onClose={() => {
          handoff.current = null;
          Keyboard.dismiss();
          setAdding(false);
        }}
        onDismiss={finishHandoff}
      >
        <UsernameFriendSearch
          onAdded={() => void load()}
          onNavigate={(target) => {
            Keyboard.dismiss();
            handoff.current = target;
            setAdding(false);
          }}
        />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: space.sm, gap: space.lg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: 32,
    lineHeight: 40,
    letterSpacing: -0.6,
    color: colors.text,
  },
  caption: { fontSize: 14, lineHeight: 20, color: colors.muted },
  group: { gap: space.sm },
  sectionHead: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  requestAction: {
    width: MIN_TARGET,
    minHeight: MIN_TARGET,
    borderRadius: radius.sm,
    borderWidth: 0,
    marginLeft: space.xs,
  },
  createGroup: { borderWidth: 0, borderRadius: radius.md, backgroundColor: colors.card },
});
