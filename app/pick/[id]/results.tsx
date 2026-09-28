import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { ErrorBanner } from '@/components/ErrorBanner';
import { PlacePhoto } from '@/components/PlaceCard';
import { colors } from '@/components/theme';
import { useSession } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { messageOf } from '@/lib/errors';
import { ordinal } from '@/lib/places';
import { queries } from '@/lib/queries';
import {
  shouldRequestRank,
  viewFromDecision,
  viewFromStored,
  type ResultsView,
} from '@/lib/results';
import type { Candidate } from '@/lib/types';

// Users see RANK ONLY. Nothing on this screen may show a score; neither the API nor our
// queries return one.

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; view: ResultsView; places: Map<string, Candidate> };

/** The host of a swiping Pick ranks it (POST /rank); everyone else reads what's stored. */
async function loadResults(pickId: string, userId: string) {
  const outcome = await queries.getPickOutcome(pickId);
  if (!outcome) throw new Error('This Pick doesn’t exist or you’re not in it.');

  let view: ResultsView;
  if (shouldRequestRank(outcome, userId)) {
    view = viewFromDecision((await api.rankPick(pickId)).decision);
  } else if (outcome.state === 'completed' || outcome.state === 'final_vote') {
    view = viewFromStored(outcome, await queries.getRankingResults(pickId));
  } else {
    view = viewFromStored(outcome, []);
  }
  const candidates = await queries.getCandidates(pickId);
  return { view, places: new Map(candidates.map((c) => [c.placeId, c])) };
}

const WAITING_COPY = {
  host: {
    title: 'Waiting for the host',
    body: 'Results appear once the host closes swiping. Your answers stay private until then.',
  },
  ranking: { title: 'Ranking in progress…', body: 'This usually takes a few seconds.' },
  not_started: { title: 'This Pick hasn’t started yet.', body: 'Check back once swiping opens.' },
} as const;

export default function ResultsScreen() {
  const { id: pickId = '' } = useLocalSearchParams<{ id: string }>();
  const session = useSession();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    loadResults(pickId, session.user.id).then(
      (ready) => active && setLoad({ status: 'ready', ...ready }),
      (e: unknown) => active && setLoad({ status: 'error', message: messageOf(e) }),
    );
    return () => {
      active = false;
    };
  }, [pickId, session.user.id, attempt]);

  const retry = () => {
    setLoad({ status: 'loading' });
    setAttempt((a) => a + 1);
  };
  const home = () => router.dismissTo('/');

  if (load.status === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.muted}>Loading results…</Text>
      </View>
    );
  }
  if (load.status === 'error') {
    return (
      <View style={styles.padded}>
        <ErrorBanner message={load.message} onRetry={retry} />
      </View>
    );
  }

  const { view, places } = load;
  let body;
  switch (view.kind) {
    case 'winner': {
      const winner = places.get(view.placeId);
      body = (
        <>
          <Text style={styles.title} accessibilityRole="header">
            {view.clearWinner ? 'Clear winner!' : 'The group picked'}
          </Text>
          {winner ? <ResultPlace place={winner} big /> : null}
        </>
      );
      break;
    }
    case 'vote':
      body = (
        <>
          <Text style={styles.title} accessibilityRole="header">
            Your group&apos;s top picks
          </Text>
          <Text style={styles.muted}>No clear winner, so the group votes on these next.</Text>
          {view.finalists.map((r) => {
            const place = places.get(r.placeId);
            return place ? <ResultPlace key={r.placeId} place={place} rank={r.rank} /> : null;
          })}
        </>
      );
      break;
    case 'waiting':
      body = (
        <>
          <Text style={styles.title} accessibilityRole="header">
            {WAITING_COPY[view.reason].title}
          </Text>
          <Text style={styles.muted}>{WAITING_COPY[view.reason].body}</Text>
          <Button label="Check again" variant="secondary" onPress={retry} />
        </>
      );
      break;
    case 'canceled':
      body = <Text style={styles.title}>This Pick was canceled.</Text>;
      break;
    case 'empty':
      body = (
        <>
          <Text style={styles.title}>Results aren&apos;t ready yet.</Text>
          <Button label="Check again" variant="secondary" onPress={retry} />
        </>
      );
      break;
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
