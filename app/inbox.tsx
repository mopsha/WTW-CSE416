import { Ionicons } from '@expo/vector-icons';
import {
  INBOX_REVALIDATE_LIMIT,
  type ActivityPage,
  type NotificationRow,
  type NotificationType,
} from '@shared/api/notify.ts';
import { router, useFocusEffect } from 'expo-router';
import { Fragment, useCallback, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';

import {
  Avatar,
  Button,
  Card,
  colors,
  EmptyState,
  ErrorState,
  fonts,
  radius,
  Screen,
  space,
  type,
} from '@/components';
import { useAuth } from '@/hooks/useAuth';
import { api, ApiError } from '@/lib/api';
import { messageOf } from '@/lib/errors';
import { inboxLabel, inboxRoute, inboxText } from '@/lib/inbox';
import { timeAgo } from '@/lib/time';

const ICONS: Record<NotificationType, keyof typeof Ionicons.glyphMap> = {
  friend_request: 'person-add-outline',
  friend_accepted: 'people-outline',
  hang_rsvp: 'flash-outline',
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

type Mode = 'focus' | 'refresh' | 'older';
type Load =
  | { status: 'loading' | 'ready' }
  | { status: 'error'; kind: 'initial' | 'refresh' | 'older'; message: string; retry: Mode };

export default function InboxScreen() {
  const viewer = useAuth().session?.user.id;
  return viewer ? <Inbox key={viewer} viewer={viewer} /> : null;
}

type InboxPage = {
  rows: NotificationRow[];
  nextCursor: string | null;
  olderLoaded: boolean;
  orderVersion?: string;
};
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

const activityTime = (row: NotificationRow) => row.activityAt ?? row.createdAt;
const position = (row: NotificationRow) => `${activityTime(row)}|${row.id}`;

function firstPage(page: ActivityPage): InboxPage {
  return {
    rows: page.notifications,
    nextCursor: page.nextCursor ?? null,
    olderLoaded: false,
    orderVersion: page.orderVersion,
  };
}

function mergeNewest(
  previous: InboxPage,
  newest: ActivityPage,
  verified: Map<string, NotificationRow>,
): InboxPage {
  const { notifications: rows, nextCursor } = newest;
  if (
    previous.orderVersion !== newest.orderVersion ||
    !nextCursor ||
    !rows.some((row) => verified.has(row.id)) ||
    (previous.nextCursor && comparePosition(previous.nextCursor, nextCursor) >= 0)
  )
    return firstPage(newest);

  // The shared row connects both ranges. Only keep verified rows past the newest
  // cursor, so the old tail cursor never jumps across an unvisited gap.
  const older = previous.rows.flatMap((old) => {
    const row = verified.get(old.id);
    return row && comparePosition(position(row), nextCursor) < 0 ? [row] : [];
  });
  return { ...previous, rows: [...rows, ...older] };
}

function Inbox({ viewer }: { viewer: string }) {
  const [page, setPage] = useState(emptyPage);
  const current = useRef(emptyPage);
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [pending, setPending] = useState<Mode | null>(null);
  const [checking, setChecking] = useState(true);
  const latest = useRef(0);
  const inFlight = useRef<'older' | 'newest' | null>(null);
  const hasLoaded = useRef(false);

  const fetchRows = useCallback(
    async (mode: Mode = 'focus') => {
      const previous = current.current;
      if (
        mode === 'older' ? inFlight.current || !previous.nextCursor : inFlight.current === 'newest'
      )
        return;
      inFlight.current = mode === 'older' ? 'older' : 'newest';
      const request = ++latest.current;
      setPending(mode);
      setChecking(true);
      setLoad({ status: 'loading' });
      const ids =
        previous.rows.length <= INBOX_REVALIDATE_LIMIT ? previous.rows.map((row) => row.id) : [];
      const revalidating = mode === 'older' || (previous.olderLoaded && ids.length > 0);
      const kind =
        mode === 'older'
          ? 'older'
          : hasLoaded.current || mode === 'refresh'
            ? 'refresh'
            : 'initial';
      const save = (next: InboxPage) => {
        current.current = next;
        setPage(next);
      };
      try {
        let next: InboxPage;
        // Keep all rendered rows within one authorized database snapshot. Beyond
        // the request limit, continue paging in a fresh window.
        if (mode === 'older') {
          const result = await api.revalidateNotifications(
            ids,
            viewer,
            previous.nextCursor ?? undefined,
          );
          if (!result.page) throw new Error('Missing activity page');
          if (result.page.reset || !ids.length) {
            next = { ...firstPage(result.page), olderLoaded: !result.page.reset };
          } else {
            const verified = new Map(result.notifications.map((row) => [row.id, row]));
            const rows = new Map<string, NotificationRow>();
            for (const old of previous.rows) {
              const row = verified.get(old.id);
              if (row) rows.set(row.id, row);
            }
            for (const row of result.page.notifications) rows.set(row.id, row);
            next = { ...firstPage(result.page), rows: [...rows.values()], olderLoaded: true };
          }
        } else if (revalidating) {
          const result = await api.revalidateNotifications(ids, viewer, undefined, true);
          if (!result.page) throw new Error('Missing activity page');
          next = mergeNewest(
            previous,
            result.page,
            new Map(result.notifications.map((row) => [row.id, row])),
          );
        } else {
          next = firstPage(await api.listNotifications(undefined, viewer));
        }
        if (request !== latest.current) return;
        save(next);
        hasLoaded.current = true;
        setLoad({ status: 'ready' });
      } catch (error) {
        if (request !== latest.current) return;
        let message = messageOf(error);
        let retry: Mode = kind === 'initial' ? 'focus' : 'refresh';
        let next = emptyPage;
        try {
          if (revalidating && error instanceof ApiError && error.status === 404) {
            // An older API can serve a page but cannot authorize a merged window.
            next = firstPage(
              await api.listNotifications(
                mode === 'older' ? (previous.nextCursor ?? undefined) : undefined,
                viewer,
              ),
            );
            if (request !== latest.current) return;
            save(next);
            hasLoaded.current = true;
            setLoad({ status: 'ready' });
            return;
          }
          if (mode === 'older' && ids.length === previous.rows.length) {
            // Recover the displayed range independently of the failed page query.
            const { notifications } = await api.revalidateNotifications(ids, viewer);
            const verified = new Map(notifications.map((row) => [row.id, row]));
            next = {
              ...previous,
              rows: ids.flatMap((id) => {
                const row = verified.get(id);
                return row ? [row] : [];
              }),
            };
            retry = 'older';
          }
        } catch (recoveryError) {
          message = messageOf(recoveryError);
        }
        if (request !== latest.current) return;
        save(next);
        setLoad({ status: 'error', kind, message, retry });
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
  const error = !checking && load.status === 'error' ? load : null;
  const today = new Date().toDateString();
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
    <Screen title="Activity" back onRefresh={refresh} refreshing={pending === 'refresh'}>
      {checking && rows.length > 0 ? (
        <Text accessibilityLiveRegion="polite" style={styles.checking}>
          Checking activity…
        </Text>
      ) : null}
      {error && error.kind !== 'older' ? (
        <ErrorState
          variant={error.kind === 'initial' ? 'full' : 'banner'}
          message={
            error.kind === 'refresh' ? `Couldn’t refresh activity. ${error.message}` : error.message
          }
          onRetry={() => void fetchRows(error.retry)}
        />
      ) : load.status === 'ready' && rows.length === 0 && !checking ? (
        <EmptyState
          icon="notifications-outline"
          title="No activity yet"
          body="Friend requests, invitations, and updates to your plans will appear here."
        />
      ) : (
        rows.map((n, index) => {
          if (checking) {
            return (
              <View
                key={n.id}
                style={[styles.activityCard, styles.placeholder]}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              />
            );
          }
          const route = inboxRoute(n);
          const { title, body } = inboxText(n);
          const actor = n.activity?.actorName?.trim();
          const emphasized = actor && title.startsWith(`${actor} `) ? actor : undefined;
          const section = activitySection(activityTime(n), today);
          const previous = rows[index - 1];
          return (
            <Fragment key={n.id}>
              {(!previous || activitySection(activityTime(previous), today) !== section) && (
                <Text accessibilityRole="header" style={styles.section}>
                  {section}
                </Text>
              )}
              <Card
                variant="flat"
                style={[styles.activityCard, !n.readAt && styles.unreadCard]}
                onPress={route ? () => open(n, route) : undefined}
                accessibilityLabel={inboxLabel(n)}
              >
                <View style={styles.row}>
                  {n.activity?.actorId ? (
                    <Avatar
                      name={actor || 'WTW member'}
                      avatarRef={n.activity.avatarRef}
                      size={46}
                      variant="social"
                    />
                  ) : (
                    <View style={styles.icon}>
                      <Ionicons
                        name={ICONS[n.type] ?? 'notifications-outline'}
                        size={21}
                        color={colors.primary}
                      />
                    </View>
                  )}
                  <View style={styles.text}>
                    <Text style={styles.title}>
                      {emphasized ? <Text style={styles.actor}>{emphasized}</Text> : null}
                      {title.slice(emphasized?.length ?? 0)}
                    </Text>
                    {body ? <Text style={styles.body}>{body}</Text> : null}
                    <Text style={styles.time}>{timeAgo(activityTime(n))}</Text>
                  </View>
                  {n.readAt ? null : <View style={styles.dot} />}
                </View>
              </Card>
            </Fragment>
          );
        })
      )}
      {error?.kind === 'older' ? (
        <ErrorState
          variant="banner"
          message={`Couldn’t load older activity. ${error.message}`}
          onRetry={() => void fetchRows(error.retry)}
        />
      ) : nextCursor ? (
        <Button
          label="Load older activity"
          variant="secondary"
          loading={pending === 'older'}
          disabled={checking || pending !== null}
          onPress={() => void fetchRows('older')}
        />
      ) : null}
    </Screen>
  );
}

function activitySection(value: string, today: string) {
  const date = new Date(value).toDateString();
  return date === today ? 'Today' : 'Earlier';
}

const styles = StyleSheet.create({
  checking: { ...type.caption, color: colors.muted },
  placeholder: { minHeight: 46 + 2 * space.md },
  section: { ...type.heading, color: colors.text, marginTop: space.xs },
  activityCard: { padding: space.md, borderRadius: radius.md, backgroundColor: colors.bg },
  unreadCard: { backgroundColor: colors.card },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  icon: {
    width: 46,
    height: 46,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.cardHi,
  },
  text: { flex: 1, gap: space.xs },
  title: { ...type.body, color: colors.text },
  actor: { fontFamily: fonts.semibold },
  body: { ...type.caption, color: colors.muted },
  time: { ...type.caption, color: colors.muted },
  dot: {
    width: space.sm,
    height: space.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
});
