import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, ZoomIn } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActionBar } from '@/components/ActionBar';
import { ActivityToast } from '@/components/ActivityToast';
import { AvatarStack } from '@/components/Avatars';
import { Button } from '@/components/Button';
import { ErrorBanner } from '@/components/ErrorBanner';
import { GradientButton } from '@/components/GradientButton';
import { PlaceCard } from '@/components/PlaceCard';
import { SwipeCard, type SwipeCardHandle } from '@/components/SwipeCard';
import { colors, flame, fonts } from '@/components/theme';
import { useSession } from '@/hooks/useAuth';
import { useGroupActivity } from '@/hooks/useGroupActivity';
import { api } from '@/lib/api';
import { messageOf } from '@/lib/errors';
import { prefetchGoogle } from '@/lib/googlePlaces';
import { haptic } from '@/lib/haptics';
import { ensureNotificationPermission, notifyLater } from '@/lib/notify';
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
  | {
      status: 'ready';
      candidates: Candidate[];
      pickState: PickState | null;
      hostId: string | null;
    };

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
  return {
    candidates,
    saved,
    index,
    pickState: outcome?.state ?? null,
    hostId: outcome?.hostId ?? null,
  };
}

export default function SwipeScreen() {
  const { id: pickId = '' } = useLocalSearchParams<{ id: string }>();
  const session = useSession();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [answers, setAnswers] = useState<ReadonlyMap<string, Answer>>(new Map());
  const [index, setIndex] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const card = useRef<SwipeCardHandle>(null);
  const notified = useRef(false);

  useEffect(() => {
    let active = true;
    loadDeck(pickId, session.user.id).then(
      (deck) => {
        if (!active) return;
        prefetchGoogle(deck.candidates);
        setAnswers(deck.saved);
        setIndex(deck.index);
        setLoad({
          status: 'ready',
          candidates: deck.candidates,
          pickState: deck.pickState,
          hostId: deck.hostId,
        });
      },
      (e: unknown) => active && setLoad({ status: 'error', message: messageOf(e) }),
    );
    return () => {
      active = false;
    };
  }, [pickId, session.user.id, attempt]);

  // Ask early so the "everyone's in" notification can show later in the demo.
  useEffect(() => {
    void ensureNotificationPermission();
  }, []);

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
  const next = candidates[index + 1];

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
  const total = candidates.length;

  const isHost = load.status === 'ready' && load.hostId === session.user.id;
  const swiping = load.status === 'ready' && load.pickState === 'swiping' && total > 0;
  const { toast, done, show } = useGroupActivity(swiping, answers.size, total);

  const openResults = () =>
    router.replace({ pathname: '/pick/[id]/results', params: { id: pickId } });

  // Finished: celebrate, and (host) get a real notification that the group is ready.
  useEffect(() => {
    if (!allSaved || notified.current || !swiping) return;
    notified.current = true;
    haptic.success();
    show('🎉', "You're done! Your answers are locked in.", '#2BD98B');
    if (isHost) {
      void notifyLater(
        "Everyone's in 🔥",
        'Ava, Ben and Cam finished swiping. Tap to see what the group picked.',
        `/pick/${pickId}/results`,
        4,
      );
    }
  }, [allSaved, swiping, isHost, pickId, show]);

  const retryFailed = () => {
    for (const [placeId, a] of failed) void save(placeId, a.value);
  };

  if (load.status === 'loading') {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }
  if (load.status === 'error') {
    return (
      <SafeAreaView style={[styles.screen, styles.padded]}>
        <ErrorBanner
          message={load.message}
          onRetry={() => {
            setLoad({ status: 'loading' });
            setAttempt((a) => a + 1);
          }}
        />
      </SafeAreaView>
    );
  }
  if (load.pickState !== null && load.pickState !== 'swiping') {
    const hasResults = ['ranking', 'final_vote', 'completed'].includes(load.pickState);
    return (
      <SafeAreaView style={[styles.screen, styles.padded, styles.center, { gap: 16 }]}>
        <Text style={styles.bigEmoji}>🗳️</Text>
        <Text style={styles.title}>Swiping is closed for this Pick.</Text>
        {hasResults ? <GradientButton label="See results" onPress={openResults} /> : null}
      </SafeAreaView>
    );
  }
  if (total === 0) {
    return (
      <SafeAreaView style={[styles.screen, styles.padded, styles.center]}>
        <Text style={styles.title}>No places in this Pick yet.</Text>
      </SafeAreaView>
    );
  }

  const position = Math.min(index + 1, total);
  const friendsDone = done.size;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom', 'left', 'right']}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back to your Picks"
          style={styles.iconBtn}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={styles.topTitle}>Dinner near campus</Text>
          <Text style={styles.topSub}>
            {friendsDone === 3 ? 'Everyone else is done 👀' : `${friendsDone} of 3 friends done`}
          </Text>
        </View>
        <AvatarStack size={28} done={done} showYou={false} />
      </View>

      <View style={styles.progressRow}>
        <View style={styles.bar} accessible={false}>
          <LinearGradient
            colors={flame}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.barFill, { width: `${(answers.size / total) * 100}%` }]}
          />
        </View>
        <Text
          style={styles.progress}
          accessibilityLabel={current ? `Card ${position} of ${total}` : `All ${total} answered`}
        >
          {current ? `${position}/${total}` : `${total}/${total}`}
        </Text>
      </View>

      {failed.length > 0 ? (
        <ErrorBanner
          message={`${failed.length === 1 ? '1 answer' : `${failed.length} answers`} didn’t save: ${failed[0]?.[1].error ?? ''}`}
          onRetry={retryFailed}
        />
      ) : null}

      {current ? (
        <>
          <View style={styles.deck}>
            {next ? (
              <View style={styles.nextCard} pointerEvents="none" accessible={false}>
                <PlaceCard place={next} />
              </View>
            ) : null}
            <SwipeCard ref={card} key={current.placeId} place={current} onAnswer={answer} />
          </View>
          <ActionBar
            placeName={current.name}
            selected={answers.get(current.placeId)?.value}
            onAnswer={(v) => card.current?.fling(v)}
            onBack={index > 0 ? () => setIndex((i) => Math.max(0, i - 1)) : undefined}
          />
        </>
      ) : (
        <View style={styles.done}>
          <Animated.Text entering={ZoomIn.springify()} style={styles.bigEmoji}>
            🙌
          </Animated.Text>
          <Animated.View entering={FadeInDown.delay(150)} style={{ alignItems: 'center', gap: 8 }}>
            <Text style={styles.title} accessibilityRole="header">
              You&apos;re in!
            </Text>
            <Text style={styles.muted}>
              {saving > 0
                ? 'Saving your answers…'
                : failed.length > 0
                  ? 'Some answers didn’t save. Retry above to finish.'
                  : isHost
                    ? 'Your answers stay private. Only the group ranking is shared.'
                    : 'Waiting for the host to close swiping. Your answers stay private.'}
            </Text>
          </Animated.View>
          <Animated.View entering={FadeInDown.delay(300)} style={styles.doneCard}>
            <AvatarStack size={44} done={new Set([...done, 'You'])} />
            <Text style={styles.doneText}>
              {friendsDone === 3 ? 'All 4 of you are done 🔥' : `${friendsDone + 1} of 4 done`}
            </Text>
          </Animated.View>
          <Animated.View entering={FadeInDown.delay(450)} style={{ alignSelf: 'stretch', gap: 6 }}>
            {isHost ? (
              <GradientButton
                label="See what the group picked 🔥"
                accessibilityHint="Closes swiping for everyone and shows the group ranking"
                disabled={!allSaved}
                loading={saving > 0}
                onPress={openResults}
              />
            ) : (
              <GradientButton
                label="Check results"
                disabled={!allSaved}
                loading={saving > 0}
                onPress={openResults}
              />
            )}
            <Button label="Review my answers" variant="link" onPress={() => setIndex(0)} />
          </Animated.View>
        </View>
      )}

      {toast ? <ActivityToast key={toast.id} toast={toast} /> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: 14,
    paddingBottom: 14,
    gap: 12,
  },
  center: { alignItems: 'center', justifyContent: 'center' },
  padded: { padding: 24 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 4 },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
  },
  topTitle: { fontFamily: fonts.bold, fontSize: 17, color: colors.text },
  topSub: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4 },
  bar: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.card, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 3 },
  progress: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.text,
    minWidth: 44,
    textAlign: 'right',
  },
  deck: { flex: 1 },
  nextCard: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    transform: [{ scale: 0.94 }, { translateY: 18 }],
    opacity: 0.55,
  },
  done: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18, paddingHorizontal: 10 },
  bigEmoji: { fontSize: 72 },
  title: { fontFamily: fonts.black, fontSize: 30, color: colors.text, textAlign: 'center' },
  muted: { fontFamily: fonts.medium, fontSize: 15, color: colors.muted, textAlign: 'center' },
  doneCard: {
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.card,
    borderRadius: 24,
    paddingVertical: 18,
    paddingHorizontal: 24,
    borderWidth: 1,
    borderColor: colors.border,
  },
  doneText: { fontFamily: fonts.bold, fontSize: 16, color: colors.text },
});
