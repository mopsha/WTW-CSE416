import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { ErrorBanner } from '@/components/ErrorBanner';
import { colors, MIN_TARGET } from '@/components/theme';
import { useSession } from '@/hooks/useAuth';
import { auth } from '@/lib/auth';
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

function titleFor(p: PickSummary) {
  return p.category === 'activities' ? 'Activities Pick' : 'Food Pick';
}

function open(p: PickSummary) {
  if (p.state === 'swiping') router.push({ pathname: '/pick/[id]/swipe', params: { id: p.id } });
  else if (p.state === 'ranking' || p.state === 'final_vote' || p.state === 'completed') {
    router.push({ pathname: '/pick/[id]/results', params: { id: p.id } });
  }
}

export default function HomeScreen() {
  const session = useSession();
  const [picks, setPicks] = useState<PickSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setPicks(await queries.listMyPicks(session.user.id));
    } catch (e) {
      setError(messageOf(e));
    }
  }, [session.user.id]);

  // Reload whenever Home comes back into focus (e.g. after swiping or ranking).
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <View style={styles.screen}>
      {USE_MOCK ? (
        <View style={styles.mock}>
          <Text style={styles.mockText}>Mock mode: data is local and resets on reload.</Text>
          <Button
            label="Reset demo"
            variant="secondary"
            onPress={() => {
              resetMockData();
              void load();
            }}
          />
        </View>
      ) : null}

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

      {picks === null && !error ? (
        <ActivityIndicator style={styles.loading} size="large" color={colors.primary} />
      ) : (
        <FlatList
          data={picks ?? []}
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            picks ? (
              <Text style={styles.empty}>
                No Picks yet. When a friend invites you to one, it shows up here.
              </Text>
            ) : null
          }
          renderItem={({ item }) => {
            const openable = item.state !== 'draft' && item.state !== 'canceled';
            return (
              <Pressable
                onPress={() => open(item)}
                disabled={!openable}
                accessibilityRole="button"
                accessibilityLabel={`${titleFor(item)}, ${STATE_LABEL[item.state]}`}
                accessibilityHint={
                  item.state === 'swiping' ? 'Opens the swipe deck' : 'Opens the results'
                }
                accessibilityState={{ disabled: !openable }}
                style={({ pressed }) => [
                  styles.row,
                  !openable && styles.rowDisabled,
                  pressed && styles.rowPressed,
                ]}
              >
                <Text style={styles.rowTitle}>{titleFor(item)}</Text>
                <Text style={styles.rowState}>{STATE_LABEL[item.state]}</Text>
              </Pressable>
            );
          }}
        />
      )}

      <Text style={styles.signedIn}>Signed in as {session.user.email ?? 'you'}</Text>
      <Button label="Sign out" variant="link" onPress={() => void auth.signOut()} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16, gap: 12 },
  mock: {
    gap: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.infoBg,
  },
  mockText: { color: colors.text, fontSize: 15 },
  loading: { marginTop: 32 },
  list: { gap: 10, flexGrow: 1 },
  empty: { color: colors.muted, fontSize: 16, textAlign: 'center', marginTop: 32 },
  row: {
    minHeight: MIN_TARGET + 24,
    padding: 16,
    borderRadius: 14,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    gap: 2,
  },
  rowDisabled: { opacity: 0.5 },
  rowPressed: { opacity: 0.8 },
  rowTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  rowState: { fontSize: 15, color: colors.muted },
  signedIn: { textAlign: 'center', color: colors.muted, fontSize: 14 },
});
