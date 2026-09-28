import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AnswerButtons } from '@/components/AnswerButtons';
import { Button } from '@/components/Button';
import { ErrorBanner } from '@/components/ErrorBanner';
import { SwipeCard } from '@/components/SwipeCard';
import { colors } from '@/components/theme';
import { useSession } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { messageOf } from '@/lib/errors';
import { queries } from '@/lib/queries';
import { firstUnansweredIndex } from '@/lib/resume';
import type { Candidate, PickState, PreferenceValue } from '@/lib/types';

interface Answer {
  value: PreferenceValue;
  status: 'saving' | 'saved' | 'failed';
  error?: string;
}

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; candidates: Candidate[]; pickState: PickState | null };

/** Reads the deck and my existing answers (RLS: only mine) so I resume where I left off. */
async function loadDeck(pickId: string, userId: string) {
  const [candidates, mine, outcome] = await Promise.all([
    queries.getCandidates(pickId),
    queries.getMyPreferences(pickId, userId),
    queries.getPickOutcome(pickId),
  ]);
  const saved = new Map<string, Answer>(
    mine.map((p) => [p.placeId, { value: p.value, status: 'saved' }]),
  );
  const index = firstUnansweredIndex(
    candidates.map((c) => c.placeId),
    new Set(saved.keys()),
  );
  return { candidates, saved, index, pickState: outcome?.state ?? null };
}

export default function SwipeScreen() {
  const { id: pickId = '' } = useLocalSearchParams<{ id: string }>();
  const session = useSession();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [answers, setAnswers] = useState<ReadonlyMap<string, Answer>>(new Map());
  const [index, setIndex] = useState(0);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    loadDeck(pickId, session.user.id).then(
      (deck) => {
        if (!active) return;
        setAnswers(deck.saved);
        setIndex(deck.index);
        setLoad({ status: 'ready', candidates: deck.candidates, pickState: deck.pickState });
      },
      (e: unknown) => active && setLoad({ status: 'error', message: messageOf(e) }),
    );
    return () => {
      active = false;
    };
  }, [pickId, session.user.id, attempt]);

  /** Optimistic: record locally first, then POST; a failure is shown with Retry. */
  const save = useCallback(
    async (placeId: string, value: PreferenceValue) => {
      const settle = (next: Answer) =>
        setAnswers((prev) => {
          // Ignore a stale response if the answer was changed while this one was in flight.
          if (prev.get(placeId)?.value !== value) return prev;
          return new Map(prev).set(placeId, next);
        });
      setAnswers((prev) => new Map(prev).set(placeId, { value, status: 'saving' }));
      try {
        await api.submitSwipe(pickId, placeId, value);
        settle({ value, status: 'saved' });
      } catch (e) {
        settle({ value, status: 'failed', error: messageOf(e) });
      }
    },
    [pickId],
  );

  const candidates = useMemo(() => (load.status === 'ready' ? load.candidates : []), [load]);
  const ids = useMemo(() => candidates.map((c) => c.placeId), [candidates]);
  const current = candidates[index];

  const answer = useCallback(
    (value: PreferenceValue) => {
      if (!current) return;
      void save(current.placeId, value);
      const answered = new Set(answers.keys()).add(current.placeId);
      setIndex(firstUnansweredIndex(ids, answered, index + 1));
    },
    [current, save, answers, ids, index],
  );

  const failed = [...answers].filter(([, a]) => a.status === 'failed');
  const saving = [...answers.values()].filter((a) => a.status === 'saving').length;
  const allAnswered = ids.length > 0 && ids.every((id) => answers.has(id));
  const allSaved = allAnswered && ids.every((id) => answers.get(id)?.status === 'saved');

  const retryFailed = () => {
    for (const [placeId, a] of failed) void save(placeId, a.value);
  };

  if (load.status === 'loading') {
    return <ActivityIndicator style={styles.center} size="large" color={colors.primary} />;
  }
  if (load.status === 'error') {
    return (
      <View style={styles.padded}>
        <ErrorBanner
          message={load.message}
          onRetry={() => {
            setLoad({ status: 'loading' });
            setAttempt((a) => a + 1);
          }}
        />
      </View>
    );
  }
  if (load.pickState !== null && load.pickState !== 'swiping') {
    const hasResults = ['ranking', 'final_vote', 'completed'].includes(load.pickState);
    return (
      <View style={[styles.padded, styles.gap]}>
        <Text style={styles.title}>This Pick isn&apos;t taking answers anymore.</Text>
        {hasResults ? (
          <Button
            label="See results"
            onPress={() =>
              router.replace({ pathname: '/pick/[id]/results', params: { id: pickId } })
            }
          />
        ) : null}
      </View>
    );
  }
  if (candidates.length === 0) {
    return (
      <View style={styles.padded}>
        <Text style={styles.title}>No places in this Pick yet.</Text>
      </View>
    );
  }

  const total = candidates.length;
  const position = Math.min(index + 1, total);
  const failedBanner =
    failed.length > 0 ? (
      <ErrorBanner
        message={`${failed.length === 1 ? '1 answer' : `${failed.length} answers`} didn’t save: ${failed[0]?.[1].error ?? ''}`}
        onRetry={retryFailed}
      />
    ) : null;

  return (
    <SafeAreaView style={styles.screen} edges={['bottom', 'left', 'right']}>
      <View style={styles.progressRow}>
        <Text
          style={styles.progress}
          accessibilityLabel={current ? `Card ${position} of ${total}` : `All ${total} answered`}
        >
          {current ? `${position} / ${total}` : `${total} / ${total}`}
        </Text>
        <View style={styles.bar} accessible={false}>
          <View style={[styles.barFill, { width: `${(answers.size / total) * 100}%` }]} />
        </View>
      </View>

      {failedBanner}

      {current ? (
        <>
          <View style={styles.deck}>
            <SwipeCard key={current.placeId} place={current} onAnswer={answer} />
          </View>
          <AnswerButtons
            placeName={current.name}
            selected={answers.get(current.placeId)?.value}
            onAnswer={answer}
          />
          <Button
            label="Back"
            variant="link"
            disabled={index === 0}
            accessibilityHint="Go to the previous card to change your answer"
            onPress={() => setIndex((i) => Math.max(0, i - 1))}
          />
        </>
      ) : (
        <View style={[styles.done, styles.gap]}>
          <Text style={styles.title} accessibilityRole="header">
            You&apos;ve answered all {total}.
          </Text>
          <Text style={styles.muted}>
            {saving > 0
              ? 'Saving your answers…'
              : failed.length > 0
                ? 'Some answers didn’t save. Retry above before ranking.'
                : 'Your answers stay private. Only the group ranking is shared.'}
          </Text>
          <Button
            label="Rank"
            disabled={!allSaved}
            loading={saving > 0}
            onPress={() =>
              router.replace({ pathname: '/pick/[id]/results', params: { id: pickId } })
            }
          />
          <Button label="Review my answers" variant="link" onPress={() => setIndex(0)} />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 16, paddingTop: 12, gap: 12 },
  center: { flex: 1 },
  padded: { padding: 16 },
  gap: { gap: 12 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  progress: { fontSize: 17, fontWeight: '700', color: colors.text, minWidth: 64 },
  bar: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: colors.primary },
  deck: { flex: 1 },
  done: { flex: 1, justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  muted: { fontSize: 16, color: colors.muted },
});
