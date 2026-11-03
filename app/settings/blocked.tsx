import type { BlockedUser } from '@shared/api/safety.ts';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Text } from 'react-native';
import { Button, Card, ErrorState, Screen, colors, type } from '@/components';
import { ListRow } from '@/components/TabUi';
import { api } from '@/lib/api';
import { confirmAction } from '@/lib/confirm';
import { messageOf } from '@/lib/errors';
export default function BlockedUsersSettings() {
  const [users, setUsers] = useState<BlockedUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const pending = useRef(false);
  const latest = useRef(0);
  const load = useCallback(async () => {
    const request = ++latest.current;
    try {
      const response = await api.listBlockedUsers();
      if (request === latest.current) {
        setUsers(response.users);
        setError(null);
      }
    } catch (e) {
      if (request === latest.current) setError(messageOf(e));
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      void load();
      return () => {
        latest.current++;
      };
    }, [load]),
  );
  const unblock = async (user: BlockedUser) => {
    if (pending.current) return;
    pending.current = true;
    try {
      if (
        !(await confirmAction({
          title: `Unblock ${user.displayName ?? 'this user'}?`,
          message:
            'Unblocking does not restore your friendship. You can send a new friend request afterward.',
          confirmLabel: 'Unblock',
        }))
      )
        return;
      setBusy(user.userId);
      setError(null);
      await api.unblockUser(user.userId);
      await load();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      pending.current = false;
      setBusy(null);
    }
  };
  return (
    <Screen title="Blocked users" back onRefresh={() => void load()}>
      <Text style={{ ...type.caption, color: colors.muted }}>
        Unblocking does not restore a friendship or add anyone to a group.
      </Text>
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {users === null && !error ? (
        <ActivityIndicator color={colors.primary} accessibilityLabel="Loading blocked users" />
      ) : null}
      {users?.length === 0 ? (
        <Card>
          <Text style={{ ...type.body, color: colors.text }}>You haven’t blocked anyone.</Text>
        </Card>
      ) : null}
      {users?.length ? (
        <Card>
          {users.map((user) => (
            <ListRow
              key={user.userId}
              title={user.displayName ?? 'Blocked user'}
              subtitle={user.displayName ? undefined : user.userId}
              right={
                <Button
                  label="Unblock"
                  variant="secondary"
                  loading={busy === user.userId}
                  disabled={busy !== null}
                  accessibilityLabel={`Unblock ${user.displayName ?? user.userId}`}
                  onPress={() => void unblock(user)}
                />
              }
            />
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}
