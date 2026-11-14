import { GroupAvatar } from '@/components/GroupAvatar';
import { ConversationHeader } from '@/components/ConversationHeader';
import { usePrivateRefresh } from '@/hooks/usePrivateRefresh';
import { emptyMessageDraft } from '@/components/MessageThread';
import { GroupChat } from '@/components/GroupChat';
import { MemberMenu } from '@/components/MemberMenu';
import { ListRow, Segments } from '@/components/TabUi';
import type { GroupInvitation } from '@shared/api/groupInvitations.ts';
import { GroupIdeas } from '@/components/GroupIdeas';
// One group: Start a Pick, members, add friends (owner), recent Picks, rename/delete or leave.
// Non-members (and removed members) get "not found": RLS returns no row.
import { Ionicons } from '@expo/vector-icons';
import { Redirect, router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Keyboard,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  Avatar,
  Button,
  Card,
  colors,
  EmptyState,
  ErrorState,
  fonts,
  MIN_TARGET,
  IconButton,
  radius,
  Screen,
  space,
  type,
} from '@/components';
import { useSession } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { confirmAction } from '@/lib/confirm';
import { messageOf } from '@/lib/errors';
import {
  addableFriends,
  groupNameProblem,
  MAX_GROUP_NAME,
  memberName,
  newGroupPickRoute,
  type FriendOption,
  type GroupDetail,
} from '@/lib/groups';
import { haptic } from '@/lib/haptics';
import { pickEmoji, pickTitle, STATE_LABEL } from '@/lib/pickUi';
import { queries } from '@/lib/queries';

export default function GroupScreen({ details = false }: { details?: boolean }) {
  const { id = '', section: initialSection } = useLocalSearchParams<{
    id: string;
    section?: string;
  }>();
  const session = useSession();
  if (!details && ['details', 'ideas', 'members'].includes(initialSection ?? '')) {
    return (
      <Redirect
        href={{ pathname: '/groups/[id]/details', params: { id, section: initialSection } }}
      />
    );
  }
  return (
    <GroupConversation
      key={`${id}:${session.user.id}:${session.user.email ?? ''}`}
      id={id}
      details={details}
      initialSection={initialSection}
      me={session.user.id}
    />
  );
}
type Section = 'chat' | 'plans' | 'details' | 'ideas' | 'members';
function GroupConversation({
  id,
  initialSection,
  me,
  details,
}: {
  id: string;
  initialSection?: string;
  me: string;
  details: boolean;
}) {
  const initial: Section = details
    ? initialSection === 'ideas' || initialSection === 'members'
      ? initialSection
      : 'details'
    : initialSection === 'plans'
      ? 'plans'
      : 'chat';
  const [section, setSection] = useState<Section>(initial);
  const [primary, setPrimary] = useState<'chat' | 'plans'>(initial === 'plans' ? 'plans' : 'chat');
  const primaryVisible = section === 'chat' || section === 'plans';
  const [group, setGroup] = useState<GroupDetail | null | undefined>(undefined);
  const visibleGroup = useRef<GroupDetail | null>(null);
  useLayoutEffect(() => {
    visibleGroup.current = group ?? null;
  }, [group]);
  const navigate = useCallback(
    (next: Section) => {
      if (!details && next === 'details') {
        Keyboard.dismiss();
        router.push({ pathname: '/groups/[id]/details', params: { id } });
        return;
      }
      if (details && next === 'plans') {
        router.dismissTo({ pathname: '/groups/[id]', params: { id, section: 'plans' } });
        return;
      }
      if (next !== 'chat') Keyboard.dismiss();
      setSection(next);
      if (next === 'chat' || next === 'plans') setPrimary(next);
      router.setParams({ section: next });
    },
    [details, id],
  );
  const back = useCallback(() => {
    if (section === 'ideas' || section === 'members') navigate('details');
    else if (details) {
      if (router.canGoBack()) router.back();
      else router.replace({ pathname: '/groups/[id]', params: { id } });
    } else if (router.canGoBack()) router.back();
    else router.replace('/groups');
  }, [section, details, id, navigate]);
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        if (primaryVisible || section === 'details' || !visibleGroup.current) return false;
        back();
        return true;
      });
      return () => subscription.remove();
    }, [back, primaryVisible, section]),
  );
  const composerRef = useRef(emptyMessageDraft().current);
  // Each focus session invalidates completions started on a previous visit.
  const focus = useRef<object | null>(null);
  useFocusEffect(
    useCallback(() => {
      const visit = {};
      focus.current = visit;
      return () => {
        focus.current = null;
      };
    }, []),
  );
  const active = useRef(true);
  const writing = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      composerRef.current = emptyMessageDraft().current;
    };
  }, [composerRef]);
  // A notification can update this route's section without mounting a new group.
  useEffect(() => {
    let current = true;
    void Promise.resolve().then(() => {
      if (!current || !active.current) return;
      setSection(initial);
      if (initial === 'chat' || initial === 'plans') setPrimary(initial);
    });
    return () => {
      current = false;
    };
  }, [initial, initialSection]);
  const [pendingInvites, setPendingInvites] = useState<GroupInvitation[]>([]);
  const [friends, setFriends] = useState<FriendOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');

  const latest = useRef(0);
  const auxiliaryLoaded = useRef(false);
  const memberKey = useRef<string | null>(null);
  const clear = useCallback(() => {
    latest.current++;
    auxiliaryLoaded.current = false;
    setGroup(undefined);
    setFriends([]);
    setPendingInvites([]);
    setEditing(false);
    setName('');
    setError(null);
  }, []);
  const load = useCallback(async () => {
    const request = ++latest.current;
    try {
      const g = await queries.getGroup(id);
      if (request !== latest.current) return;
      setGroup(g);
      setError(null);
      if (!g) {
        composerRef.current = emptyMessageDraft().current;
        auxiliaryLoaded.current = false;
        setFriends([]);
        setPendingInvites([]);
        setEditing(false);
        setName('');
        return;
      }
      const key = g.members
        .map((m) => m.userId)
        .sort()
        .join(',');
      if (!auxiliaryLoaded.current || memberKey.current !== key) {
        const [f, invites] = await Promise.all([
          queries.listMyFriends(me),
          g.ownerId === me
            ? api.listPendingGroupInvitations(id)
            : Promise.resolve({ invitations: [] }),
        ]);
        if (request !== latest.current) return;
        setFriends(f);
        setPendingInvites(invites.invitations);
        auxiliaryLoaded.current = true;
        memberKey.current = key;
      }
    } catch (e) {
      if (request === latest.current) {
        auxiliaryLoaded.current = false;
        setGroup(undefined);
        setFriends([]);
        setPendingInvites([]);
        setEditing(false);
        setName('');
        setError(messageOf(e));
      }
    }
  }, [id, me, composerRef]);
  usePrivateRefresh(load, clear);

  /** Run a write, then reload; `key` marks which button shows a spinner. */
  const run = async (key: string, write: () => Promise<unknown>, after?: () => void) => {
    if (writing.current || !active.current || !focus.current) return;
    const visit = focus.current;
    writing.current = true;
    setBusy(key);
    setError(null);
    try {
      await write();
      if (!active.current || focus.current !== visit) return;
      haptic.success();
      if (after) after();
      else if (visibleGroup.current) {
        auxiliaryLoaded.current = false;
        await load();
      }
    } catch (e) {
      if (active.current && focus.current === visit) setError(messageOf(e));
    } finally {
      writing.current = false;
      if (active.current) setBusy(null);
    }
  };

  if (group === undefined && !error) {
    return (
      <Screen back>
        <ActivityIndicator
          style={{ marginTop: space.xxl }}
          size="large"
          color={colors.primary}
          accessibilityLabel="Loading the group"
        />
      </Screen>
    );
  }
  if (!group) {
    return (
      <Screen back>
        {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
        {group === null ? (
          <EmptyState
            emoji="🔍"
            title="Group not found"
            body="It was deleted, or you're not in it anymore. Picks you were in are still in your History."
            action={{ label: 'Back to groups', onPress: () => router.replace('/groups') }}
          />
        ) : null}
      </Screen>
    );
  }

  const isOwner = group.ownerId === me;
  const toAdd = isOwner ? addableFriends(friends, group.members) : [];

  const saveName = () => {
    const problem = groupNameProblem(name);
    if (problem) {
      setError(problem);
      return;
    }
    void run(
      'rename',
      () => api.renameGroup(group.id, name.trim()),
      () => {
        setEditing(false);
        void load();
      },
    );
  };

  const renderMember = (m: GroupDetail['members'][number]) => (
    <View key={m.userId} style={styles.member}>
      <Pressable
        style={styles.memberIdentity}
        accessibilityRole="button"
        accessibilityLabel={`View ${m.userId === me ? 'your' : memberName(m) + '’s'} profile`}
        onPress={() =>
          router.push(
            m.userId === me ? '/(tabs)/profile' : { pathname: '/p/[id]', params: { id: m.userId } },
          )
        }
      >
        <Avatar name={memberName(m)} userId={m.userId} size={40} />
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{m.userId === me ? 'You' : memberName(m)}</Text>
          {m.role === 'owner' ? <Text style={styles.sub}>Owner</Text> : null}
        </View>
      </Pressable>
      {m.userId !== me ? (
        <MemberMenu userId={m.userId} name={memberName(m)} onBlocked={() => void load()} />
      ) : null}
      {isOwner && m.role !== 'owner' ? (
        <Pressable
          onPress={async () => {
            const ok = await confirmAction({
              title: `Remove ${memberName(m)}?`,
              message: 'They keep the Picks they were in, but won’t be added to new ones.',
              confirmLabel: 'Remove',
              destructive: true,
            });
            if (ok) void run(`remove:${m.userId}`, () => api.removeGroupMember(group.id, m.userId));
          }}
          disabled={busy !== null}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${memberName(m)} from ${group.name}`}
          style={styles.iconBtn}
        >
          {busy === `remove:${m.userId}` ? (
            <ActivityIndicator color={colors.muted} />
          ) : (
            <Ionicons name="close" size={22} color={colors.muted} />
          )}
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <Screen
      scroll={false}
      keyboardBehavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      contentStyle={{ padding: 0, paddingBottom: 0, gap: space.sm }}
      onRefresh={() => {
        auxiliaryLoaded.current = false;
        void load();
      }}
    >
      {/* Details is a native stack push; local management sections retain explicit Back. */}
      <Stack.Screen options={{ gestureEnabled: primaryVisible || section === 'details' }} />
      {primaryVisible ? (
        <ConversationHeader
          group
          name={group.name}
          subtitle={`${group.members.length} ${group.members.length === 1 ? 'member' : 'members'}`}
          onBack={back}
          onPress={() => navigate('details')}
          accessibilityLabel={`Group details for ${group.name}, ${group.members.length} ${group.members.length === 1 ? 'member' : 'members'}`}
        />
      ) : (
        <View style={styles.subheader}>
          <IconButton icon="chevron-back" accessibilityLabel="Back" onPress={back} />
          <Text style={styles.heading} accessibilityRole="header">
            {section === 'details'
              ? 'Group details'
              : section === 'ideas'
                ? 'Group Ideas'
                : 'Members'}
          </Text>
        </View>
      )}
      {primaryVisible ? (
        <View style={styles.chatInset}>
          <Segments
            label="Group sections"
            variant="underline"
            value={primary}
            onChange={navigate}
            options={[
              { value: 'chat', label: 'Chat' },
              { value: 'plans', label: 'Plans' },
            ]}
          />
        </View>
      ) : null}
      {error ? (
        <View style={styles.chatInset}>
          <ErrorState message={error} onRetry={() => void load()} />
        </View>
      ) : null}
      {/* Keep the draft, retry ID and scroll position while browsing this group's views.
          The existing focus/background hooks still clear revoked private data. */}
      {!details ? (
        <View
          style={[styles.chat, section !== 'chat' && styles.hidden]}
          accessibilityElementsHidden={section !== 'chat'}
          importantForAccessibility={section === 'chat' ? 'auto' : 'no-hide-descendants'}
        >
          <GroupChat
            key={`${group.id}:${me}`}
            groupId={group.id}
            userId={me}
            composerRef={composerRef}
            onRefresh={() => {
              auxiliaryLoaded.current = false;
              return load();
            }}
          />
        </View>
      ) : null}
      {section !== 'chat' ? (
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={false}
              onRefresh={() => {
                auxiliaryLoaded.current = false;
                void load();
              }}
              tintColor={colors.primary}
            />
          }
        >
          {section === 'details' ? (
            <>
              <View style={styles.hero}>
                <GroupAvatar name={group.name} size={64} />
                <Text style={styles.groupName} accessibilityRole="header">
                  {group.name}
                </Text>
                <Text style={styles.sub}>
                  {group.members.length} {group.members.length === 1 ? 'member' : 'members'}
                </Text>
              </View>
              <View style={styles.rows}>
                <ListRow
                  title="Group Ideas"
                  subtitle="Save ideas for your next Pick"
                  leading={
                    <View style={styles.rowIcon}>
                      <Ionicons name="bulb-outline" size={20} color={colors.primary} />
                    </View>
                  }
                  onPress={() => navigate('ideas')}
                />
                <ListRow
                  title="Group plans"
                  subtitle="Picks and shared history"
                  leading={
                    <View style={styles.rowIcon}>
                      <Ionicons name="calendar-outline" size={20} color={colors.primary} />
                    </View>
                  }
                  onPress={() => navigate('plans')}
                />
                {isOwner ? (
                  <ListRow
                    title="Add members"
                    leading={
                      <View style={styles.rowIcon}>
                        <Ionicons name="person-add-outline" size={20} color={colors.primary} />
                      </View>
                    }
                    onPress={() => navigate('members')}
                  />
                ) : null}
              </View>
              <View style={styles.memberHeading}>
                <Text style={styles.heading} accessibilityRole="header">
                  Members · {group.members.length}
                </Text>
                {group.members.length > 5 || isOwner ? (
                  <Button
                    label="See all members"
                    variant="link"
                    size="compact"
                    onPress={() => navigate('members')}
                  />
                ) : null}
              </View>
              <Card>{group.members.slice(0, 5).map(renderMember)}</Card>
              {isOwner ? (
                <Button
                  label="Share invite link"
                  icon="link-outline"
                  variant="link"
                  size="compact"
                  loading={busy === 'link'}
                  disabled={busy !== null}
                  onPress={() =>
                    void run('link', async () => {
                      const link = await api.createInvite({ kind: 'group', targetId: group.id });
                      if (active.current && visibleGroup.current?.id === group.id)
                        await Share.share({ message: `Join ${group.name} on WTW: ${link.url}` });
                    })
                  }
                />
              ) : null}
            </>
          ) : null}
          {section === 'ideas' ? (
            <GroupIdeas key={`${group.id}:${me}`} group={group} userId={me} showHeading={false} />
          ) : null}
          {section === 'plans' ? (
            <Button
              label="Start a Pick"
              icon="flame"
              onPress={() => router.push(newGroupPickRoute(group))}
              accessibilityHint={`Creates a Pick with everyone in ${group.name}`}
            />
          ) : null}
          {section === 'members' ? (
            <>
              <Card>{group.members.map(renderMember)}</Card>

              {isOwner ? (
                <Card>
                  <Text style={styles.heading} accessibilityRole="header">
                    Invite friends
                  </Text>
                  <Text style={styles.sub}>They join only after accepting your invitation.</Text>
                  {pendingInvites.length ? (
                    <Text style={styles.sub}>
                      {pendingInvites.length} pending{' '}
                      {pendingInvites.length === 1 ? 'invitation' : 'invitations'}
                    </Text>
                  ) : null}
                  {toAdd.length === 0 ? (
                    <Text style={styles.sub}>
                      {friends.length === 0
                        ? 'Only accepted friends can be invited. Add friends on the Friends tab first.'
                        : 'All your friends are already in this group.'}
                    </Text>
                  ) : (
                    toAdd.map((f) => (
                      <View key={f.userId} style={styles.member}>
                        <Avatar name={memberName(f)} userId={f.userId} size={40} />
                        <Text style={[styles.name, { flex: 1 }]}>{memberName(f)}</Text>
                        <Button
                          label={
                            pendingInvites.some((i) => i.inviteeId === f.userId)
                              ? 'Pending'
                              : 'Invite'
                          }
                          variant="secondary"
                          icon="add"
                          loading={busy === `add:${f.userId}`}
                          disabled={
                            busy !== null || pendingInvites.some((i) => i.inviteeId === f.userId)
                          }
                          onPress={() =>
                            void run(`add:${f.userId}`, () =>
                              api.addGroupMembers(group.id, [f.userId]),
                            )
                          }
                          accessibilityLabel={`Invite ${memberName(f)} to ${group.name}`}
                        />
                      </View>
                    ))
                  )}
                </Card>
              ) : null}
            </>
          ) : null}
          {section === 'plans' ? (
            <>
              {group.picks.length === 0 ? (
                <EmptyState
                  emoji="📅"
                  title="No group Picks yet"
                  body="Start a Pick to make your next plan together."
                />
              ) : null}
              {group.picks.length > 0 ? (
                <Card>
                  <Text style={styles.heading} accessibilityRole="header">
                    Recent Picks
                  </Text>
                  {group.picks.map((p) => (
                    <Pressable
                      key={p.id}
                      onPress={() => router.push({ pathname: '/pick/[id]', params: { id: p.id } })}
                      accessibilityRole="button"
                      accessibilityLabel={`${pickTitle(p.category)}, ${STATE_LABEL[p.state]}`}
                      style={styles.member}
                    >
                      <Text style={{ fontSize: 22 }}>{pickEmoji(p.category)}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.name}>{pickTitle(p.category)}</Text>
                        <Text style={styles.sub}>{STATE_LABEL[p.state]}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={20} color={colors.muted} />
                    </Pressable>
                  ))}
                </Card>
              ) : null}

              <Button
                label="See group history"
                variant="link"
                onPress={() => router.push({ pathname: '/history', params: { groupId: group.id } })}
                accessibilityHint={`Every finished Pick in ${group.name}`}
              />
            </>
          ) : null}

          {section === 'details' ? (
            <>
              {isOwner ? (
                <Card>
                  {editing ? (
                    <>
                      <TextInput
                        style={styles.input}
                        value={name}
                        onChangeText={setName}
                        maxLength={MAX_GROUP_NAME + 10}
                        autoFocus
                        editable={busy === null}
                        returnKeyType="done"
                        onSubmitEditing={saveName}
                        accessibilityLabel="New group name"
                      />
                      <Button
                        label="Save name"
                        loading={busy === 'rename'}
                        onPress={saveName}
                        variant="secondary"
                      />
                      <Button
                        label="Cancel"
                        variant="link"
                        disabled={busy !== null}
                        onPress={() => setEditing(false)}
                      />
                    </>
                  ) : (
                    <Button
                      label="Rename group"
                      icon="pencil"
                      variant="secondary"
                      onPress={() => {
                        setName(group.name);
                        setEditing(true);
                      }}
                    />
                  )}
                  <Button
                    label="Delete group"
                    icon="trash"
                    variant="danger"
                    loading={busy === 'delete'}
                    onPress={async () => {
                      const ok = await confirmAction({
                        title: `Delete ${group.name}?`,
                        message: 'Everyone keeps their past Picks and results.',
                        confirmLabel: 'Delete',
                        destructive: true,
                      });
                      if (ok)
                        void run(
                          'delete',
                          () => api.deleteGroup(group.id),
                          () => {
                            router.dismissAll();
                            router.replace('/groups');
                          },
                        );
                    }}
                  />
                </Card>
              ) : (
                <ListRow
                  title={busy === 'leave' ? 'Leaving group…' : 'Leave group'}
                  danger
                  leading={
                    <View style={styles.rowIcon}>
                      <Ionicons name="exit-outline" size={20} color={colors.primary} />
                    </View>
                  }
                  disabled={busy !== null}
                  onPress={async () => {
                    const ok = await confirmAction({
                      title: `Leave ${group.name}?`,
                      message: 'You keep your past Picks, but won’t be added to new ones.',
                      confirmLabel: 'Leave',
                      destructive: true,
                    });
                    if (ok)
                      void run(
                        'leave',
                        () => api.leaveGroup(group.id),
                        () => {
                          router.dismissAll();
                          router.replace('/groups');
                        },
                      );
                  }}
                />
              )}
            </>
          ) : null}
        </ScrollView>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chatInset: { marginHorizontal: space.lg },
  chat: { flex: 1 },
  hidden: { display: 'none' },
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  subheader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    minHeight: MIN_TARGET + space.lg,
  },
  hero: { alignItems: 'center', gap: space.xs, paddingVertical: space.sm },
  memberHeading: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  rowIcon: {
    width: MIN_TARGET - space.sm,
    height: MIN_TARGET - space.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.cardHi,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupName: { ...type.heading, color: colors.text, textAlign: 'center' },
  rows: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    overflow: 'hidden',
    paddingHorizontal: space.md,
  },
  heading: { fontFamily: fonts.bold, fontSize: 17, color: colors.text },
  memberIdentity: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: MIN_TARGET,
  },
  member: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: MIN_TARGET + 8,
  },
  name: { fontFamily: fonts.bold, fontSize: 16, color: colors.text },
  sub: { ...type.caption, color: colors.muted },
  iconBtn: {
    width: MIN_TARGET,
    height: MIN_TARGET,
    borderRadius: MIN_TARGET / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    minHeight: MIN_TARGET + 4,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 20,
    fontFamily: fonts.medium,
    fontSize: 16,
    color: colors.text,
  },
});
