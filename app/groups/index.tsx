import { GroupCardsSkeleton } from '@/components/LoadingStates';
// Groups: the ones I'm in, a quick "Start a Pick" on each, and a new-group form.
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
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
import { usePrivateRefresh } from '@/hooks/usePrivateRefresh';
import { useSession } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { isAccessDenied, messageOf } from '@/lib/errors';
import {
  groupNameProblem,
  MAX_GROUP_NAME,
  memberCountLabel,
  newGroupPickRoute,
  type GroupSummary,
} from '@/lib/groups';
import { haptic } from '@/lib/haptics';
import { queries } from '@/lib/queries';

export default function GroupsScreen() {
  const session = useSession();
  return <GroupsContent key={session.user.id} userId={session.user.id} />;
}

function GroupsContent({ userId }: { userId: string }) {
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const latest = useRef(0);
  const active = useRef(false);
  const mounted = useRef(true);
  const creatingRef = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const clear = useCallback(() => {
    active.current = false;
    latest.current++;
    setGroups(null);
    setError(null);
    setRefreshing(false);
  }, []);
  const load = useCallback(async () => {
    if (!active.current) return;
    const request = ++latest.current;
    const current = () => active.current && request === latest.current;
    try {
      const next = await queries.listMyGroups(userId);
      if (!current()) return;
      setGroups(next);
      setError(null);
    } catch (e) {
      if (!current()) return;
      if (isAccessDenied(e)) setGroups(null);
      setError(messageOf(e));
    }
  }, [userId]);
  const refresh = useCallback(() => {
    active.current = true;
    return load();
  }, [load]);
  usePrivateRefresh(refresh, clear);

  const create = async () => {
    if (creatingRef.current || !mounted.current) return;
    const problem = groupNameProblem(name);
    setNameError(problem);
    if (problem) return;
    creatingRef.current = true;
    setCreating(true);
    try {
      const group = await api.createGroup(name.trim());
      if (!mounted.current) return;
      haptic.success();
      setName('');
      // Straight to the new group so the owner can add friends.
      router.push({ pathname: '/groups/[id]', params: { id: group.id } });
    } catch (e) {
      if (mounted.current) setNameError(messageOf(e));
    } finally {
      creatingRef.current = false;
      if (mounted.current) setCreating(false);
    }
  };

  return (
    <Screen
      title="Groups"
      subtitle="The same crew, again and again."
      back
      refreshing={refreshing}
      onRefresh={async () => {
        setRefreshing(true);
        await load();
        if (active.current) setRefreshing(false);
      }}
    >
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      {groups === null && !error ? <GroupCardsSkeleton /> : null}

      {groups && groups.length === 0 ? (
        <EmptyState
          emoji="👯"
          title="No groups yet"
          body="Make one for the people you always pick with, then start a Pick for all of them in a tap."
        />
      ) : null}

      {groups?.map((g) => (
        <Card key={g.id}>
          <View style={styles.row}>
            <Pressable
              style={({ pressed }) => [styles.identity, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={`${g.name}, ${memberCountLabel(g.memberCount)}${g.isOwner ? ', you own it' : ''}`}
              accessibilityHint="Opens the group"
              onPress={() => {
                haptic.tap();
                router.push({ pathname: '/groups/[id]', params: { id: g.id } });
              }}
            >
              <Text style={styles.name}>{g.name}</Text>
              <Text style={styles.sub}>
                {memberCountLabel(g.memberCount)}
                {g.isOwner ? ' · Owner' : ''}
              </Text>
            </Pressable>
            <Button
              label="Start a Pick"
              variant="secondary"
              icon="flame"
              onPress={() => router.push(newGroupPickRoute(g))}
              accessibilityLabel={`Start a Pick with ${g.name}`}
            />
          </View>
        </Card>
      ))}

      <Card>
        <Text style={styles.heading} accessibilityRole="header">
          New group
        </Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={(t) => {
            setName(t);
            if (nameError) setNameError(null);
          }}
          placeholder="Roommates"
          placeholderTextColor={colors.muted}
          maxLength={MAX_GROUP_NAME + 10}
          returnKeyType="done"
          onSubmitEditing={() => void create()}
          accessibilityLabel="Group name"
        />
        {nameError ? (
          <Text style={styles.error} accessibilityRole="alert">
            {nameError}
          </Text>
        ) : null}
        <Button label="Create group" icon="add" loading={creating} onPress={() => void create()} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  identity: { flex: 1, gap: 2, minHeight: MIN_TARGET, justifyContent: 'center' },
  pressed: { opacity: 0.85 },
  name: { fontFamily: fonts.bold, fontSize: 17, color: colors.text },
  sub: { ...type.caption, color: colors.muted },
  heading: { fontFamily: fonts.bold, fontSize: 17, color: colors.text },
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
  error: { ...type.caption, color: colors.danger },
});
