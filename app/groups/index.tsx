// Groups: the ones I'm in, a quick "Start a Pick" on each, and a new-group form.
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';

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
import { useSession } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { messageOf } from '@/lib/errors';
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
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setGroups(await queries.listMyGroups(session.user.id));
    } catch (e) {
      setError(messageOf(e));
    }
  }, [session.user.id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const create = async () => {
    const problem = groupNameProblem(name);
    setNameError(problem);
    if (problem) return;
    setCreating(true);
    try {
      const group = await api.createGroup(name.trim());
      haptic.success();
      setName('');
      // Straight to the new group so the owner can add friends.
      router.push({ pathname: '/groups/[id]', params: { id: group.id } });
    } catch (e) {
      setNameError(messageOf(e));
    } finally {
      setCreating(false);
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
        setRefreshing(false);
      }}
    >
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      {groups === null && !error ? (
        <ActivityIndicator
          style={{ marginTop: space.xl }}
          size="large"
          color={colors.primary}
          accessibilityLabel="Loading your groups"
        />
      ) : null}

      {groups && groups.length === 0 ? (
        <EmptyState
          emoji="👯"
          title="No groups yet"
          body="Make one for the people you always pick with, then start a Pick for all of them in a tap."
        />
      ) : null}

      {groups?.map((g) => (
        <Card
          key={g.id}
          onPress={() => router.push({ pathname: '/groups/[id]', params: { id: g.id } })}
          accessibilityLabel={`${g.name}, ${memberCountLabel(g.memberCount)}${g.isOwner ? ', you own it' : ''}`}
          accessibilityHint="Opens the group"
        >
          <View style={styles.row}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.name}>{g.name}</Text>
              <Text style={styles.sub}>
                {memberCountLabel(g.memberCount)}
                {g.isOwner ? ' · Owner' : ''}
              </Text>
            </View>
            <Button
              label="Start a Pick"
              variant="secondary"
              icon="flame"
              onPress={() => {
                haptic.tap();
                router.push(newGroupPickRoute(g));
              }}
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
