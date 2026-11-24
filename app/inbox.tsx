import { Ionicons } from '@expo/vector-icons';
import type { NotificationRow, NotificationType } from '@shared/api/notify.ts';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';

import {
  Button,
  Card,
  colors,
  EmptyState,
  ErrorState,
  fonts,
  Screen,
  space,
  type,
} from '@/components';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { messageOf } from '@/lib/errors';
import { inboxLabel, inboxRoute, inboxText } from '@/lib/inbox';
import { timeAgo } from '@/lib/time';

const ICONS: Record<NotificationType, keyof typeof Ionicons.glyphMap> = {
  group_invite: 'people-outline',
  hang_invite: 'flash-outline',
  group_message: 'chatbubbles-outline',
  direct_message: 'chatbubble-outline',
  added_to_pick: 'person-add-outline',
  pick_started: 'flame-outline',
  reminder: 'time-outline',
  vote_needed: 'hand-left-outline',
  winner_decided: 'trophy-outline',
  pick_canceled: 'close-circle-outline',
  plan_time_set: 'calendar-outline',
  time_suggested: 'calendar-outline',
  plan_reminder: 'alarm-outline',
  did_you_go: 'help-circle-outline',
};

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready' };

export default function InboxScreen() {
  const viewer = useAuth().session?.user.id;
  return viewer ? <Inbox key={viewer} viewer={viewer} /> : null;
}

type InboxPage = { rows: NotificationRow[]; nextCursor: string | null; olderLoaded: boolean };
const emptyPage: InboxPage = { rows: [], nextCursor: null, olderLoaded: false };

// PostgreSQL cursors preserve microseconds, while Date.parse only preserves milliseconds.
function comparePosition(a: string, b: string) {
  const [aTime, aId] = a.split('|');
  const [bTime, bId] = b.split('|');
  if (!aTime || !aId || !bTime || !bId) throw new Error('Invalid notification cursor');
  const micros = (time: string) =>
    Date.parse(time) * 1000 + Number((time.match(/\.(\d+)/)?.[1] ?? '').padEnd(6, '0').slice(3, 6));
  return micros(aTime) - micros(bTime) || aId.localeCompare(bId);
}

const position = (row: NotificationRow) => `${row.createdAt}|${row.id}`;

function mergeNewest(
  previous: InboxPage,
  newest: { notifications: NotificationRow[]; nextCursor?: string | null },
  verified: Map<string, NotificationRow>,
): InboxPage {
  const known = new Set(previous.rows.map((row) => row.id));
  const rows = newest.notifications
    .filter((row) => !known.has(row.id) || verified.has(row.id))
    .map((row) => ({ ...row, readAt: row.readAt ?? verified.get(row.id)?.readAt ?? null }));
  const nextCursor = newest.nextCursor ?? null;
  if (
    !nextCursor ||
    !rows.some((row) => verified.has(row.id)) ||
    (previous.nextCursor && comparePosition(previous.nextCursor, nextCursor) >= 0)
  )
    return { rows, nextCursor, olderLoaded: false };

  // The shared row connects both ranges. Only keep verified rows past the newest
  // cursor, so the old tail cursor never jumps across an unvisited gap.
  const older = previous.rows.flatMap((old) => {
    const row = verified.get(old.id);
    return row && comparePosition(position(row), nextCursor) < 0 ? [row] : [];
  });
  return { rows: [...rows, ...older], nextCursor: previous.nextCursor, olderLoaded: true };
}

function Inbox({ viewer }: { viewer: string }) {
  const [page, setPage] = useState(emptyPage);
  const current = useRef(emptyPage);
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [pending, setPending] = useState<'focus' | 'refresh' | 'older' | null>(null);
  const [checking, setChecking] = useState(true);
  const latest = useRef(0);
  const inFlight = useRef<'older' | 'newest' | null>(null);

  const fetchRows = useCallback(
    async (mode: 'focus' | 'refresh' | 'older' = 'focus') => {
      const previous = current.current;
      if (
        mode === 'older' ? inFlight.current || !previous.nextCursor : inFlight.current === 'newest'
      )
        return;
      inFlight.current = mode === 'older' ? 'older' : 'newest';
      const request = ++latest.current;
      setPending(mode);
      setChecking(true);
      try {
        let next: InboxPage;
        if (mode === 'older') {
          const result = await api.revalidateNotifications(
            previous.rows.map((row) => row.id),
            viewer,
            previous.nextCursor ?? undefined,
          );
          const verified = new Map(result.notifications.map((row) => [row.id, row]));
          const rows = new Map<string, NotificationRow>();
          // Keep the original order for preserved pages. The cursor remains valid
          // even when the row that supplied it has since become unavailable.
          for (const old of previous.rows) {
            const row = verified.get(old.id);
            if (row) rows.set(row.id, row);
          }
          const known = new Set(previous.rows.map((row) => row.id));
          for (const row of result.page?.notifications ?? []) {
            if (!known.has(row.id)) rows.set(row.id, row);
          }
          next = {
            rows: [...rows.values()],
            nextCursor: result.page ? result.page.nextCursor : previous.nextCursor,
            olderLoaded: true,
          };
        } else if (previous.olderLoaded && previous.rows.length) {
          const [newest, result] = await Promise.all([
            api.listNotifications(undefined, viewer),
            api.revalidateNotifications(
              previous.rows.map((row) => row.id),
              viewer,
            ),
          ]);
          next = mergeNewest(
            previous,
            newest,
            new Map(result.notifications.map((row) => [row.id, row])),
          );
        } else {
          const result = await api.listNotifications(undefined, viewer);
          next = {
            rows: result.notifications,
            nextCursor: result.nextCursor ?? null,
            olderLoaded: false,
          };
        }
        if (request !== latest.current) return;
        current.current = next;
        setPage(next);
        setLoad({ status: 'ready' });
      } catch (error) {
        if (request !== latest.current) return;
        current.current = emptyPage;
        setPage(emptyPage);
        setLoad({ status: 'error', message: messageOf(error) });
      } finally {
        if (request === latest.current) {
          inFlight.current = null;
          setPending(null);
          setChecking(false);
        }
      }
    },
    [viewer],
  );

  useFocusEffect(
    useCallback(() => {
      const invalidate = () => {
        latest.current++;
        inFlight.current = null;
        setChecking(true);
      };
      if (AppState.currentState !== 'background' && AppState.currentState !== 'inactive') {
        void fetchRows();
      }
      const subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') void fetchRows();
        else invalidate();
      });
      return () => {
        subscription.remove();
        invalidate();
      };
    }, [fetchRows]),
  );

  const refresh = () => void fetchRows('refresh');
  const { rows, nextCursor } = page;
  const open = (n: NotificationRow, route: string) => {
    if (checking) return;
    if (!n.readAt) {
      const readAt = new Date().toISOString();
      const snapshot = {
        ...current.current,
        rows: current.current.rows.map((x) => (x.id === n.id ? { ...x, readAt } : x)),
      };
      current.current = snapshot;
      setPage(snapshot);
      void api.markNotificationRead(n.id, viewer).catch(() => {});
    }
    router.push(route as never);
  };

  return (
    <Screen title="Notifications" back onRefresh={refresh} refreshing={pending === 'refresh'}>
      {load.status === 'error' && rows.length === 0 ? (
        <ErrorState message={load.message} onRetry={refresh} />
      ) : load.status === 'ready' && rows.length === 0 && !checking ? (
        <EmptyState
          icon="notifications-outline"
          title="Nothing yet"
          body="You'll see it here when a Pick starts, it's time to vote, or there's a winner."
        />
      ) : (
        rows.map((n) => {
          const route = inboxRoute(n);
          if (checking) {
            return (
              <Card key={n.id} accessibilityLabel="Checking notification">
                <View style={styles.placeholder} />
              </Card>
            );
          }
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
      {nextCursor ? (
        <Button
          label="Load older notifications"
          variant="secondary"
          loading={pending === 'older'}
          disabled={checking || pending !== null}
          onPress={() => void fetchRows('older')}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  placeholder: { minHeight: 58 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  text: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.medium, fontSize: 16, color: colors.text },
  unreadTitle: { fontFamily: fonts.bold },
  body: { ...type.caption, color: colors.muted },
  time: { ...type.caption, color: colors.muted },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 6, backgroundColor: colors.primary },
});
