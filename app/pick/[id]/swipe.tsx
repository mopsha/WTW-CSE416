// Swipe (swiping): my own shuffled deck from GET /picks/:id, one card at a time, in the
// live-demo style. Resumes at my first unanswered card, lets me go back and change an answer,
// saves each answer optimistically with Retry, and shows the group's progress live.
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActionBar } from '@/components/ActionBar';
import { ActivityToast } from '@/components/ActivityToast';
import { Button } from '@/components/Button';
import { ErrorBanner } from '@/components/ErrorBanner';
import { HostMenu } from '@/components/HostMenu';
import { PlaceCard } from '@/components/PlaceCard';
import { PlaceDetailsSheet } from '@/components/PlaceDetailsSheet';
import {
  CenterMessage,
  GroupAvatars,
  goToPicks,
  PickTopBar,
  pickStyles,
} from '@/components/PickParts';
import { SwipeCard, type SwipeCardHandle } from '@/components/SwipeCard';
import { colors, flame, fonts } from '@/components/theme';
import { useCountdown } from '@/hooks/useCountdown';
import { usePickLive } from '@/hooks/usePickLive';
import { usePickRoute } from '@/hooks/usePickRoute';
import { useProgressToasts } from '@/hooks/useProgressToasts';
import { api, ApiError } from '@/lib/api';
import { messageOf } from '@/lib/errors';
import { prefetchGoogle } from '@/lib/googlePlaces';
import { haptic } from '@/lib/haptics';
import { pickTitle } from '@/lib/pickUi';
import { firstUnansweredIndex } from '@/lib/resume';
import type { Candidate, PickDetail, PreferenceValue } from '@/lib/types';

interface Answer {
  value: PreferenceValue;
  status: 'saving' | 'saved' | 'failed';
  error?: string;
}

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; pick: PickDetail };

export default function SwipeScreen() {
  const { id: pickId = '', review } = useLocalSearchParams<{ id: string; review?: string }>();
  const live = usePickLive(pickId);
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [answers, setAnswers] = useState<ReadonlyMap<string, Answer>>(new Map());
  const [index, setIndex] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [details, setDetails] = useState<Candidate | null>(null);
  const card = useRef<SwipeCardHandle>(null);
  const reviewing = useRef(review === '1');
  // 0 → 1 as the top card is dragged away: the card behind grows and brightens (Tinder-style).
  const drag = useSharedValue(0);
  const nextStyle = useAnimatedStyle(() => ({
    opacity: interpolate(drag.value, [0, 1], [0.6, 1]),
    transform: [
      { scale: interpolate(drag.value, [0, 1], [0.93, 1]) },
      { translateY: interpolate(drag.value, [0, 1], [16, 0]) },
    ],
  }));

  // My deck in my order + my saved answers, so reopening resumes at the right card.
  useEffect(() => {
    let active = true;
    api.getPick(pickId).then(
      (pick) => {
        if (!active) return;
        prefetchGoogle(pick.candidates);
        const saved = new Map<string, Answer>(
          Object.entries(pick.myAnswers).map(([placeId, value]) => [
            placeId,
            { value, status: 'saved' },
          ]),
        );
        const ids = pick.candidates.map((c) => c.placeId);
        setAnswers(saved);
        setIndex(reviewing.current ? 0 : firstUnansweredIndex(ids, new Set(saved.keys())));
        setLoad({ status: 'ready', pick });
      },
      (e: unknown) => active && setLoad({ status: 'error', message: messageOf(e) }),
    );
    return () => {
      active = false;
    };
  }, [pickId, attempt]);

  const reload = useCallback(() => {
    setLoad({ status: 'loading' });
    setAttempt((a) => a + 1);
  }, []);

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
        // The host refreshed the pool under us: my deck is stale, so load the new one.
        if (e instanceof ApiError && e.code === 'INVALID_CANDIDATE') return reload();
        settle({ value, status: 'failed', error: messageOf(e) });
      }
    },
    [pickId, reload],
  );

  const pick = load.status === 'ready' ? load.pick : null;
  const candidates = useMemo(() => pick?.candidates ?? [], [pick]);
  const ids = useMemo(() => candidates.map((c) => c.placeId), [candidates]);
  const total = candidates.length;
  const current = candidates[index];
  const next = candidates[index + 1];

  const failed = [...answers].filter(([, a]) => a.status === 'failed');
  const allAnswered = total > 0 && ids.every((id) => answers.has(id));
  const allSaved = allAnswered && ids.every((id) => answers.get(id)?.status === 'saved');

  usePickRoute(pickId, 'swipe', live.state ?? pick?.state ?? null, { allAnswered });
  const { toast } = useProgressToasts(live.progress);
  const countdown = useCountdown(live.deadline ?? pick?.deadlineAt ?? null);

  // The host refreshed the pool (everyone's answers were cleared): start over on the new deck.
  const myDone = live.progress?.participants.find((p) => p.isMe)?.done;
  const wasDone = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    if (wasDone.current === true && myDone === false && allSaved) reload();
    wasDone.current = myDone;
  }, [myDone, allSaved, reload]);

  // Done (and not reviewing): on to the waiting room.
  useEffect(() => {
    if (!allSaved || current) return;
    haptic.success();
    const t = setTimeout(
      () => router.replace({ pathname: '/pick/[id]/waiting', params: { id: pickId } }),
      reviewing.current ? 0 : 700,
    );
    return () => clearTimeout(t);
  }, [allSaved, current, pickId]);

  const answer = useCallback(
    (value: PreferenceValue) => {
      if (!current) return;
      void save(current.placeId, value);
      // Reviewing steps through every card; otherwise skip ones answered on an earlier visit.
      const answered = new Set(answers.keys()).add(current.placeId);
      setIndex(reviewing.current ? index + 1 : firstUnansweredIndex(ids, answered, index + 1));
    },
    [current, save, answers, ids, index],
  );

  const retryFailed = () => {
    for (const [placeId, a] of failed) void save(placeId, a.value);
  };

  const others = (live.progress?.participants ?? []).filter((p) => !p.isMe);
  const othersDone = others.filter((p) => p.done).length;
  const subtitle = [
    others.length
      ? othersDone === others.length
        ? 'Everyone else is done 👀'
        : `${othersDone} of ${others.length} friends done`
      : null,
    countdown.label,
  ]
    .filter(Boolean)
    .join(' · ');

  if (load.status === 'loading') {
    return (
      <View style={[pickStyles.screen, styles.center]}>
        <ActivityIndicator
          size="large"
          color={colors.primary}
          accessibilityLabel="Loading places"
        />
      </View>
    );
  }
  if (load.status === 'error') {
    return (
      <SafeAreaView style={pickStyles.screen}>
        <PickTopBar title="Swipe" />
        <CenterMessage emoji="📡" title="Couldn’t load the places" body={load.message}>
          <Button label="Try again" onPress={reload} />
          <Button label="Back to your Picks" variant="link" onPress={goToPicks} />
        </CenterMessage>
      </SafeAreaView>
    );
  }
  if (total === 0) {
    return (
      <SafeAreaView style={pickStyles.screen}>
        <PickTopBar title={pickTitle(pick?.category)} />
        <CenterMessage
          emoji="🗺️"
          title="No places yet"
          body="The pool is still being built. This usually takes a second."
        >
          <Button label="Check again" onPress={reload} />
        </CenterMessage>
      </SafeAreaView>
    );
  }

  const position = Math.min(index + 1, total);

  return (
    <SafeAreaView style={pickStyles.screen} edges={['top', 'bottom', 'left', 'right']}>
      <PickTopBar
        title={pickTitle(pick?.category)}
        subtitle={subtitle || null}
        right={
          pick?.isHost ? (
            <HostMenu pickId={pickId} onChanged={() => void live.refresh()} />
          ) : (
            <GroupAvatars people={others} size={26} />
          )
        }
      />
      <View style={styles.body}>
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

        {live.error ? (
          <ErrorBanner message={`${live.error} Your answers will still save when you’re back.`} />
        ) : null}
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
                <Animated.View
                  style={[styles.nextCard, nextStyle]}
                  pointerEvents="none"
                  accessible={false}
                >
                  <PlaceCard place={next} />
                </Animated.View>
              ) : null}
              <SwipeCard
                ref={card}
                key={current.placeId}
                place={current}
                onAnswer={answer}
                drag={drag}
                onInfo={() => setDetails(current)}
              />
            </View>
            <ActionBar
              placeName={current.name}
              selected={answers.get(current.placeId)?.value}
              onAnswer={(v) => card.current?.fling(v)}
              onBack={index > 0 ? () => setIndex((i) => Math.max(0, i - 1)) : undefined}
            />
          </>
        ) : (
          <CenterMessage
            emoji="🙌"
            title={failed.length ? 'Almost there' : 'You’re in!'}
            body={
              failed.length
                ? 'Some answers didn’t save. Retry above to finish.'
                : 'Saving your answers…'
            }
          >
            <Button
              label="Review my answers"
              variant="link"
              onPress={() => {
                reviewing.current = true;
                setIndex(0);
              }}
            />
          </CenterMessage>
        )}
      </View>

      {toast ? <ActivityToast key={toast.id} toast={toast} /> : null}

      <PlaceDetailsSheet
        place={details}
        onClose={() => setDetails(null)}
        onAnswer={(v) => {
          setDetails(null);
          // Let the sheet slide away, then throw the card like a swipe.
          setTimeout(() => card.current?.fling(v), 350);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, paddingHorizontal: 14, paddingBottom: 14, gap: 12 },
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
  nextCard: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
});
