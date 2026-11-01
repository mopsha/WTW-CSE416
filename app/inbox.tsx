import { Ionicons } from '@expo/vector-icons';
import type { NotificationRow, NotificationType } from '@shared/api/notify.ts';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Card, colors, EmptyState, ErrorState, fonts, Screen, space, type } from '@/components';
import { api } from '@/lib/api';
import { messageOf } from '@/lib/errors';
import { inboxLabel, inboxRoute, inboxText } from '@/lib/inbox';
import { timeAgo } from '@/lib/time';

const ICONS: Record<NotificationType, keyof typeof Ionicons.glyphMap> = {
  added_to_pick: 'person-add-outline',
  pick_started: 'flame-outline',
  reminder: 'time-outline',
  vote_needed: 'hand-left-outline',
  winner_decided: 'trophy-outline',
  pick_canceled: 'close-circle-outline',
  plan_time_set: 'calendar-outline',
  plan_reminder: 'alarm-outline',
  did_you_go: 'help-circle-outline',
};

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready' };

// My newest 50 notifications (GET /notifications). Tapping one marks it read and opens its Pick.
export default function InboxScreen() {
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  // Only the newest request may update the list (a refresh can race the focus load).
  const latest = useRef(0);

  const fetchRows = useCallback(() => {
    const request = ++latest.current;
    return api.listNotifications().then(
      (r) => {
        if (request !== latest.current) return;
        setRows(r.notifications);
        setLoad({ status: 'ready' });
      },
      (e: unknown) => {
        if (request === latest.current) setLoad({ status: 'error', message: messageOf(e) });
      },
    );
  }, []);

  useFocusEffect(
    useCallback(() => {
      void fetchRows();
    }, [fetchRows]),
  );

  const refresh = () => {
    setRefreshing(true);
    void fetchRows().finally(() => setRefreshing(false));
  };

  const open = (n: NotificationRow, route: string) => {
    if (!n.readAt) {
      const readAt = new Date().toISOString();
      setRows((all) => all.map((x) => (x.id === n.id ? { ...x, readAt } : x)));
      // A failed write shows as unread again on the next load; it never blocks opening the Pick.
      void api.markNotificationRead(n.id).catch(() => {});
    }
    router.push(route as never);
  };

  return (
    <Screen title="Notifications" back onRefresh={refresh} refreshing={refreshing}>
      {/* A failed refresh keeps the list it already has. */}
      {load.status === 'error' && rows.length === 0 ? (
        <ErrorState message={load.message} onRetry={refresh} />
      ) : load.status === 'ready' && rows.length === 0 ? (
        <EmptyState
          emoji="🔔"
          title="Nothing yet"
          body="You'll see it here when a Pick starts, it's time to vote, or there's a winner."
        />
      ) : (
        rows.map((n) => {
          const route = inboxRoute(n);
          const { title, body } = inboxText(n);
          return (
            <Card
              key={n.id}
              onPress={route ? () => open(n, route) : undefined}
              accessibilityLabel={inboxLabel(n)}
              accessibilityHint="Opens the Pick"
            >
              <View style={styles.row}>
                <Ionicons
                  name={ICONS[n.type] ?? 'notifications-outline'}
                  size={22}
                  color={n.readAt ? colors.muted : colors.primary}
                />
                <View style={styles.text}>
                  <Text style={[styles.title, !n.readAt && styles.unreadTitle]}>{title}</Text>
                  <Text style={styles.body}>{body}</Text>
                  <Text style={styles.time}>{timeAgo(n.createdAt)}</Text>
                </View>
                {n.readAt ? null : <View style={styles.dot} />}
              </View>
            </Card>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  text: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.medium, fontSize: 16, color: colors.text },
  unreadTitle: { fontFamily: fonts.bold },
  body: { ...type.caption, color: colors.muted },
  time: { ...type.caption, color: colors.muted },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 6, backgroundColor: colors.primary },
});
