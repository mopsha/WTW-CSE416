// History (FR-18, Alan): completed Picks I was in, newest first, with the winner, the top three
// by rank (never scores or anyone's answers), who was there, and how many went. With
// ?groupId=… it shows that group's Picks (Razin's group screen links here).
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { HistoryItem } from '@shared/api/plans.ts';

import { Card, colors, EmptyState, ErrorState, fonts, Screen } from '@/components';
import { api } from '@/lib/api';
import { messageOf } from '@/lib/errors';
import { formatPlanTime } from '@/lib/plans';

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready' };

function names(item: HistoryItem): string {
  const people = item.participants.map((p) => p.displayName?.trim() || 'Someone');
  return people.length > 3
    ? `${people.slice(0, 3).join(', ')} +${people.length - 3}`
    : people.join(', ');
}

export default function HistoryScreen() {
  const { groupId } = useLocalSearchParams<{ groupId?: string }>();
  const [picks, setPicks] = useState<HistoryItem[]>([]);
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [refreshing, setRefreshing] = useState(false);

  // Only the newest request may update the list (a refresh can race the first load).
  const latest = useRef(0);
  const fetchHistory = useCallback(() => {
    const request = ++latest.current;
    return api.getHistory(groupId).then(
      (r) => {
        if (request !== latest.current) return;
        setPicks(r.picks);
        setLoad({ status: 'ready' });
      },
      (e: unknown) => {
        if (request === latest.current) setLoad({ status: 'error', message: messageOf(e) });
      },
    );
  }, [groupId]);
  useEffect(() => void fetchHistory(), [fetchHistory]);

  const refresh = () => {
    setRefreshing(true);
    void fetchHistory().finally(() => setRefreshing(false));
  };

  return (
    <Screen
      title={groupId ? 'Group history' : 'History'}
      subtitle="Every Pick you finished, newest first"
      back
      onRefresh={refresh}
      refreshing={refreshing}
    >
      {/* A failed refresh keeps the list it already has. */}
      {load.status === 'error' && picks.length === 0 ? (
        <ErrorState message={load.message} onRetry={refresh} />
      ) : load.status === 'ready' && picks.length === 0 ? (
        <EmptyState
          emoji="🗂️"
          title="No finished Picks yet"
          body="When a Pick lands on a winner, it shows up here."
        />
      ) : (
        picks.map((item) => (
          <Card
            key={item.id}
            onPress={() => router.push(`/pick/${item.id}`)}
            accessibilityLabel={`${item.winner?.name ?? 'Pick'}, decided ${formatPlanTime(item.decidedAt)}`}
            accessibilityHint="Opens the result"
          >
            <Text style={styles.date}>{formatPlanTime(item.decidedAt)}</Text>
            <Text style={styles.winner}>👑 {item.winner?.name ?? 'Winner'}</Text>
            {item.finalists
              .filter((f) => f.placeId !== item.winner?.placeId)
              .map((f) => (
                <Text key={f.placeId} style={styles.finalist}>
                  #{f.rank} {f.name ?? ''}
                </Text>
              ))}
            <View style={styles.footer}>
              <Text style={styles.people} numberOfLines={1}>
                {names(item)}
              </Text>
              {item.wentCount ? <Text style={styles.went}>{item.wentCount} went</Text> : null}
            </View>
          </Card>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  date: { fontFamily: fonts.semibold, fontSize: 13, color: colors.muted },
  winner: { fontFamily: fonts.bold, fontSize: 18, color: colors.text },
  finalist: { fontFamily: fonts.medium, fontSize: 14, color: colors.muted },
  footer: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginTop: 4 },
  people: { flex: 1, fontFamily: fonts.medium, fontSize: 13, color: colors.muted },
  went: { fontFamily: fonts.bold, fontSize: 13, color: colors.yes },
});
