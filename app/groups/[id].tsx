import { usePrivateRefresh } from '@/hooks/usePrivateRefresh';
import { GroupChat } from '@/components/GroupChat';
import { Segments } from '@/components/TabUi';
import type { GroupInvitation } from '@shared/api/groupInvitations.ts';
import { GroupIdeas } from '@/components/GroupIdeas';
// One group: Start a Pick, members, add friends (owner), recent Picks, rename/delete or leave.
// Non-members (and removed members) get "not found": RLS returns no row.
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  Avatar,
  Button,
  Card,
  colors,
  EmptyState,
  ErrorState,
  fonts,
  MIN_TARGET,
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

export default function GroupScreen() {
  const { id = '', section: initialSection } = useLocalSearchParams<{
    id: string;
    section?: string;
  }>();
  const [section, setSection] = useState<'chat' | 'plans' | 'ideas' | 'members'>(
    initialSection === 'plans' || initialSection === 'ideas' || initialSection === 'members'
      ? initialSection
      : 'chat',
  );
  const session = useSession();
  const me = session.user.id;
  const [group, setGroup] = useState<GroupDetail | null | undefined>(undefined);
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
  }, [id, me]);
  usePrivateRefresh(load, clear);

  /** Run a write, then reload; `key` marks which button shows a spinner. */
  const run = async (key: string, write: () => Promise<unknown>, after?: () => void) => {
    setBusy(key);
    setError(null);
    try {
      await write();
      haptic.success();
      if (after) after();
      else {
        auxiliaryLoaded.current = false;
        await load();
      }
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(null);
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

  return (
    <Screen
      title={group.name}
      subtitle={`${group.members.length} ${group.members.length === 1 ? 'person' : 'people'}`}
      back
      onRefresh={() => {
        auxiliaryLoaded.current = false;
        void load();
      }}
    >
      {error ? <ErrorState message={error} /> : null}

      <Segments
        label="Group sections"
        value={section}
        onChange={setSection}
        options={[
          { value: 'chat', label: 'Chat' },
          { value: 'plans', label: 'Plans' },
          { value: 'ideas', label: 'Ideas' },
          { value: 'members', label: 'Members' },
        ]}
      />
      {section === 'chat' ? (
        <GroupChat key={`${group.id}:${me}`} groupId={group.id} userId={me} />
      ) : null}
      {section === 'plans' ? (
        <Button
          label="Start a Pick"
          icon="flame"
          onPress={() => {
            haptic.tap();
            router.push(newGroupPickRoute(group));
          }}
          accessibilityHint={`Creates a Pick with everyone in ${group.name}`}
        />
      ) : null}

      {section === 'ideas' ? (
        <GroupIdeas key={`${group.id}:${me}`} group={group} userId={me} />
      ) : null}

      {section === 'members' ? (
        <>
          <Card>
            <Text style={styles.heading} accessibilityRole="header">
              Members
            </Text>
            {group.members.map((m) => (
              <View key={m.userId} style={styles.member}>
                <Avatar name={memberName(m)} userId={m.userId} size={40} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{m.userId === me ? 'You' : memberName(m)}</Text>
                  {m.role === 'owner' ? <Text style={styles.sub}>Owner</Text> : null}
                </View>
                {isOwner && m.role !== 'owner' ? (
                  <Pressable
                    onPress={async () => {
                      const ok = await confirmAction({
                        title: `Remove ${memberName(m)}?`,
                        message:
                          'They keep the Picks they were in, but won’t be added to new ones.',
                        confirmLabel: 'Remove',
                        destructive: true,
                      });
                      if (ok)
                        void run(`remove:${m.userId}`, () =>
                          api.removeGroupMember(group.id, m.userId),
                        );
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
            ))}
          </Card>

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
                        pendingInvites.some((i) => i.inviteeId === f.userId) ? 'Pending' : 'Invite'
                      }
                      variant="secondary"
                      icon="add"
                      loading={busy === `add:${f.userId}`}
                      disabled={
                        busy !== null || pendingInvites.some((i) => i.inviteeId === f.userId)
                      }
                      onPress={() =>
                        void run(`add:${f.userId}`, () => api.addGroupMembers(group.id, [f.userId]))
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

      {section === 'members' ? (
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
                  <Button label="Cancel" variant="link" onPress={() => setEditing(false)} />
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
                      () => router.replace('/groups'),
                    );
                }}
              />
            </Card>
          ) : (
            <Button
              label="Leave group"
              icon="exit-outline"
              variant="danger"
              loading={busy === 'leave'}
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
                    () => router.replace('/groups'),
                  );
              }}
            />
          )}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { fontFamily: fonts.bold, fontSize: 17, color: colors.text },
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
