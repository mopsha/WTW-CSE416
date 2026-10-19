// Waiting room (swiping, after I've answered everything): "3 of 5 finished", avatars with a
// check, the deadline countdown, and the host's Close now / Cancel. Never anyone's answers.
// When the Pick closes (host, threshold or deadline) everyone moves to the reveal by themselves.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, LinearTransition, ZoomIn } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActivityToast } from '@/components/ActivityToast';
import { Button } from '@/components/Button';
import { ErrorBanner } from '@/components/ErrorBanner';
import { GradientButton } from '@/components/GradientButton';
import {
  FlameOrb,
  goToPicks,
  GroupAvatars,
  LiveDot,
  ParticipantRow,
  PickTopBar,
  Pill,
  pickStyles,
} from '@/components/PickParts';
import { ProgressBar } from '@/components/ProgressBar';
import { useAction } from '@/hooks/useAction';
import { useCountdown } from '@/hooks/useCountdown';
import { usePickLive } from '@/hooks/usePickLive';
import { usePickRoute } from '@/hooks/usePickRoute';
import { useProgressToasts } from '@/hooks/useProgressToasts';
import { api } from '@/lib/api';
import { confirmAction } from '@/lib/confirm';
import { haptic } from '@/lib/haptics';
import { notifyLater } from '@/lib/notify';
import { progressLine } from '@/lib/pickUi';

export default function WaitingScreen() {
  const { id: pickId = '' } = useLocalSearchParams<{ id: string }>();
  const live = usePickLive(pickId);
  const progress = live.progress;
  const me = progress?.participants.find((p) => p.isMe);
  const isHost = !!me?.isHost;
  const action = useAction();
  const countdown = useCountdown(live.deadline);
  const { toast } = useProgressToasts(progress);

  // If my answers were cleared (the host refreshed the pool), I belong back on the deck.
  usePickRoute(pickId, 'waiting', live.state, { allAnswered: me?.done ?? true });
  useEffect(() => {
    if (live.state === 'swiping' && me && !me.done) {
      router.replace({ pathname: '/pick/[id]/swipe', params: { id: pickId } });
    }
  }, [live.state, me, pickId]);

  // Results came in while the app was in the background: a nudge to come back.
  const lastState = useRef(live.state);
  useEffect(() => {
    const closed = lastState.current === 'swiping' && live.state && live.state !== 'swiping';
    lastState.current = live.state;
    if (closed && AppState.currentState !== 'active') {
      void notifyLater(
        'The results are in 🔥',
        'Tap to see what the group picked.',
        `/pick/${pickId}`,
        1,
      );
    }
  }, [live.state, pickId]);

  const closeNow = async () => {
    const ok = await confirmAction({
      title: 'Close swiping now?',
      message: 'Anyone who hasn’t finished counts as Maybe on the places they skipped.',
      confirmLabel: 'Close now',
    });
    if (!ok) return;
    if (await action.run('close', () => api.closePick(pickId))) {
      haptic.success();
      void live.refresh();
    }
  };

  const cancel = async () => {
    const ok = await confirmAction({
      title: 'Cancel this Pick?',
      message: 'Swiping stops for everyone and nothing gets decided.',
      confirmLabel: 'Cancel Pick',
      destructive: true,
    });
    if (ok && (await action.run('cancel', () => api.cancelPick(pickId)))) void live.refresh();
  };

  const people = progress?.participants ?? [];
  const allDone = !!progress && progress.total > 0 && progress.doneCount >= progress.total;

  return (
    <SafeAreaView style={pickStyles.screen} edges={['top', 'left', 'right', 'bottom']}>
      <PickTopBar
        title="Waiting for the group"
        subtitle={countdown.label}
        right={<LiveDot mode={live.mode} offline={!!live.error} />}
      />
      <ScrollView contentContainerStyle={pickStyles.scroll}>
        {live.error ? (
          <ErrorBanner
            message={`${live.error} We’ll keep checking.`}
            onRetry={() => void live.refresh()}
          />
        ) : null}

        <View style={styles.hero}>
          <Animated.View entering={ZoomIn.springify()}>
            <FlameOrb emoji={allDone ? '🔥' : '⏳'} />
          </Animated.View>
          <Text
            style={pickStyles.heading}
            accessibilityRole="header"
            accessibilityLiveRegion="polite"
          >
            {progress ? progressLine(progress) : 'Checking who’s done…'}
          </Text>
          {progress ? (
            <View style={styles.bar}>
              <ProgressBar
                value={progress.doneCount}
                total={progress.total}
                accessibilityLabel={progressLine(progress)}
              />
            </View>
          ) : null}
          <Text style={pickStyles.muted}>
            {allDone
              ? 'Ranking everyone’s swipes…'
              : 'Your answers are locked in and private. Results drop as soon as the group is done.'}
          </Text>
          {countdown.label ? (
            <Pill
              icon="timer-outline"
              text={
                countdown.passed
                  ? 'Deadline passed, closing…'
                  : `Closes in ${countdown.label.replace(' left', '')}`
              }
              tone={countdown.passed ? 'warn' : 'muted'}
            />
          ) : null}
        </View>

        <Animated.View entering={FadeInDown.delay(150)} style={pickStyles.card}>
          <View style={styles.headRow}>
            <Text style={pickStyles.section}>The group</Text>
            <GroupAvatars people={people} size={28} />
          </View>
          {people.map((p) => (
            <Animated.View key={p.userId} layout={LinearTransition}>
              <ParticipantRow person={p} status={p.done ? 'Done ✓' : 'Swiping…'} />
            </Animated.View>
          ))}
        </Animated.View>

        {action.error ? <ErrorBanner message={action.error} onRetry={action.clearError} /> : null}

        {isHost ? (
          <View style={{ gap: 8 }}>
            <GradientButton
              label={allDone ? 'See results 🔥' : 'Close now and rank'}
              accessibilityHint="Closes swiping for everyone and ranks the places"
              loading={action.busy === 'close'}
              disabled={!!action.busy}
              onPress={() => void closeNow()}
            />
            <Button
              label="Cancel Pick"
              variant="link"
              loading={action.busy === 'cancel'}
              disabled={!!action.busy}
              onPress={() => void cancel()}
            />
          </View>
        ) : null}

        <Button
          label="Change my answers"
          variant="secondary"
          icon="create-outline"
          onPress={() =>
            router.replace({ pathname: '/pick/[id]/swipe', params: { id: pickId, review: '1' } })
          }
        />
        <Button label="Back to your Picks" variant="link" onPress={goToPicks} />
      </ScrollView>

      {toast ? <ActivityToast key={toast.id} toast={toast} /> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 14, paddingVertical: 8 },
  bar: { alignSelf: 'stretch' },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
