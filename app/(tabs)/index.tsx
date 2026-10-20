import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import {
  Button,
  Card,
  colors,
  EmptyState,
  ErrorState,
  fonts,
  IconButton,
  radius,
  Screen,
  space,
  type,
} from '@/components';
import { useSession } from '@/hooks/useAuth';
import { USE_MOCK } from '@/lib/config';
import { messageOf } from '@/lib/errors';
import { resetMockData } from '@/lib/mock/store';
import { queries } from '@/lib/queries';
import type { PickState, PickSummary } from '@/lib/types';

const STATE_LABEL: Record<PickState, string> = {
  draft: 'Not started',
  swiping: 'Swiping now',
  ranking: 'Ranking',
  final_vote: 'Final vote',
  completed: 'Decided',
  canceled: 'Canceled',
};

const STATE_COLOR: Record<PickState, string> = {
  draft: colors.muted,
  swiping: colors.primary,
  ranking: colors.maybe,
  final_vote: colors.maybe,
  completed: colors.yes,
  canceled: colors.muted,
};

function titleFor(p: PickSummary) {
  return p.category === 'activities' ? 'Activities Pick' : 'Food Pick';
}

function open(p: PickSummary) {
  if (p.state === 'swiping') router.push({ pathname: '/pick/[id]/swipe', params: { id: p.id } });
  else if (p.state === 'ranking' || p.state === 'final_vote' || p.state === 'completed') {
    router.push({ pathname: '/pick/[id]/results', params: { id: p.id } });
  }
}

export default function PicksScreen() {
  const session = useSession();
  const [picks, setPicks] = useState<PickSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setPicks(await queries.listMyPicks(session.user.id));
    } catch (e) {
      setError(messageOf(e));
    }
  }, [session.user.id]);

  // Reload whenever Picks comes back into focus (e.g. after swiping or ranking).
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const refresh = () => {
    setRefreshing(true);
    void load().finally(() => setRefreshing(false));
  };

  const firstName = (session.user.email ?? '').split('@')[0];

  return (
    <Screen
      title="Your Picks"
      subtitle={firstName ? `Hey ${firstName} 👋` : undefined}
      edges={['top', 'left', 'right']}
      onRefresh={refresh}
      refreshing={refreshing}
      right={
        <IconButton
          icon="add"
          accessibilityLabel="Create a Pick"
          onPress={() => router.push('/pick/new')}
        />
      }
    >
      {USE_MOCK ? (
        <View style={styles.mock}>
          <Text style={styles.mockText}>Mock mode: data is local and resets on reload.</Text>
          <Button
            label="Reset demo"
            variant="secondary"
            icon="refresh"
            onPress={() => {
              resetMockData();
              void load();
            }}
          />
        </View>
      ) : null}

      {error ? (
        <ErrorState
          variant={picks ? 'banner' : 'full'}
          message={error}
          onRetry={() => void load()}
        />
      ) : null}

      {picks === null && !error ? (
        <ActivityIndicator style={styles.loading} size="large" color={colors.primary} />
      ) : null}

      {picks && picks.length === 0 ? (
        <EmptyState
          emoji="🍽️"
          title="No Picks yet"
          body="Start one and invite friends, or wait for an invite."
          action={{ label: 'Create a Pick', icon: 'add', onPress: () => router.push('/pick/new') }}
        />
      ) : null}

      {picks?.map((item) => {
        const openable = item.state !== 'draft' && item.state !== 'canceled';
        const label = `${titleFor(item)}, ${STATE_LABEL[item.state]}`;
        const body = (
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Ionicons
                name={item.category === 'activities' ? 'bicycle' : 'restaurant'}
                size={22}
                color={colors.text}
              />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{titleFor(item)}</Text>
              <View style={styles.status}>
                <View style={[styles.dot, { backgroundColor: STATE_COLOR[item.state] }]} />
                <Text style={styles.rowState}>{STATE_LABEL[item.state]}</Text>
              </View>
            </View>
            {openable ? <Ionicons name="chevron-forward" size={20} color={colors.muted} /> : null}
          </View>
        );
        return openable ? (
          <Card
            key={item.id}
            onPress={() => open(item)}
            accessibilityLabel={label}
            accessibilityHint={
              item.state === 'swiping' ? 'Opens the swipe deck' : 'Opens the results'
            }
          >
            {body}
          </Card>
        ) : (
          <Card key={item.id} style={styles.inactive}>
            {body}
          </Card>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  mock: {
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.infoBg,
  },
  mockText: { ...type.caption, color: colors.text, fontSize: 14 },
  loading: { marginTop: space.xxl },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  rowIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.cardHi,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontFamily: fonts.bold, fontSize: 17, color: colors.text },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  rowState: { ...type.caption, color: colors.muted, fontSize: 14 },
  inactive: { opacity: 0.5 },
});
