import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { ErrorBanner } from '@/components/ErrorBanner';
import { PlacePhoto } from '@/components/PlaceCard';
import { colors } from '@/components/theme';
import { api } from '@/lib/api';
import { messageOf } from '@/lib/errors';
import { ordinal } from '@/lib/places';
import { queries } from '@/lib/queries';
import type { Candidate, PickOutcome, RankedPlace } from '@/lib/types';

// Users see RANK ONLY. Nothing on this screen may show a score; queries never fetch one.

type View_ =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      outcome: PickOutcome;
      ranking: RankedPlace[];
      places: Map<string, Candidate>;
    };

/** POST /rank (unless the Pick is already past ranking), then read the outcome via RLS. */
async function rankAndRead(pickId: string): Promise<Extract<View_, { status: 'ready' }>> {
  const before = await queries.getPickOutcome(pickId);
  if (!before) throw new Error('This Pick doesn’t exist or you’re not in it.');
  if (before.state === 'swiping' || before.state === 'ranking') await api.rankPick(pickId);

  const [outcome, ranking, candidates] = await Promise.all([
    queries.getPickOutcome(pickId),
    queries.getRankingResults(pickId),
    queries.getCandidates(pickId),
  ]);
  return {
    status: 'ready',
    outcome: outcome ?? before,
    ranking,
    places: new Map(candidates.map((c) => [c.placeId, c])),
  };
}

export default function ResultsScreen() {
  const { id: pickId = '' } = useLocalSearchParams<{ id: string }>();
  const [view, setView] = useState<View_>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    rankAndRead(pickId).then(
      (ready) => active && setView(ready),
      (e: unknown) => active && setView({ status: 'error', message: messageOf(e) }),
    );
    return () => {
      active = false;
    };
  }, [pickId, attempt]);

  const retry = () => {
    setView({ status: 'loading' });
    setAttempt((a) => a + 1);
  };
  const home = () => router.dismissTo('/');

  if (view.status === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.muted}>Ranking your group&apos;s answers…</Text>
      </View>
    );
  }
  if (view.status === 'error') {
    return (
      <View style={styles.padded}>
        <ErrorBanner message={view.message} onRetry={retry} />
      </View>
    );
  }

  const { outcome, ranking, places } = view;
  const winner = outcome.winnerPlaceId ? places.get(outcome.winnerPlaceId) : undefined;

  let body;
  if (outcome.state === 'canceled') {
    body = <Text style={styles.title}>This Pick was canceled.</Text>;
  } else if (winner) {
    body = (
      <>
        <Text style={styles.title} accessibilityRole="header">
          {outcome.decidedBy === 'clear_winner' ? 'Clear winner!' : 'The group picked'}
        </Text>
        <ResultPlace place={winner} big />
      </>
    );
  } else {
    const finalists = ranking.filter((r) => r.finalist);
    const top = (finalists.length ? finalists : ranking.slice(0, 3)).sort(
      (a, b) => a.rank - b.rank,
    );
    body = top.length ? (
      <>
        <Text style={styles.title} accessibilityRole="header">
          Your group&apos;s top picks
        </Text>
        {outcome.state === 'final_vote' ? (
          <Text style={styles.muted}>No clear winner, so the group votes on these next.</Text>
        ) : null}
        {top.map((r) => {
          const place = places.get(r.placeId);
          return place ? <ResultPlace key={r.placeId} place={place} rank={r.rank} /> : null;
        })}
      </>
    ) : (
      <>
        <Text style={styles.title}>Results aren&apos;t ready yet.</Text>
        <Button label="Check again" variant="secondary" onPress={retry} />
      </>
    );
  }

  return (
    <ScrollView contentContainerStyle={[styles.padded, styles.gap]}>
      {body}
      <Button label="Back to your Picks" variant="link" onPress={home} />
    </ScrollView>
  );
}

function ResultPlace({ place, rank, big }: { place: Candidate; rank?: number; big?: boolean }) {
  const label = rank !== undefined ? `${ordinal(rank)}: ${place.name}` : place.name;
  return (
    <View style={styles.result} accessible accessibilityLabel={label}>
      <PlacePhoto uri={place.photoUrl} style={big ? styles.photoBig : styles.photo} />
      <View style={styles.resultText}>
        {rank !== undefined ? <Text style={styles.rank}>{ordinal(rank)}</Text> : null}
        <Text style={[styles.name, big && styles.nameBig]} numberOfLines={2}>
          {place.name}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  padded: { padding: 16 },
  gap: { gap: 14 },
  title: { fontSize: 26, fontWeight: '800', color: colors.text },
  muted: { fontSize: 16, color: colors.muted },
  result: {
    backgroundColor: colors.card,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  photo: { width: '100%', height: 120 },
  photoBig: { width: '100%', aspectRatio: 4 / 3 },
  resultText: { padding: 14, gap: 2 },
  rank: { fontSize: 15, fontWeight: '700', color: colors.primary, textTransform: 'uppercase' },
  name: { fontSize: 20, fontWeight: '700', color: colors.text },
  nameBig: { fontSize: 26 },
});
