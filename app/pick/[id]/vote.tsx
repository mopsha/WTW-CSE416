// Final vote: one tap on a finalist; you can change it until the vote closes (everyone voted,
// the host closes it, or the deadline). Shows how many have voted, never for what.
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActivityToast } from '@/components/ActivityToast';
import { Button } from '@/components/Button';
import { ErrorBanner } from '@/components/ErrorBanner';
import { GradientButton } from '@/components/GradientButton';
import {
  CenterMessage,
  FlameOrb,
  goToPicks,
  GroupAvatars,
  LiveDot,
  PickTopBar,
  pickStyles,
} from '@/components/PickParts';
import { ProgressBar } from '@/components/ProgressBar';
import { BigResult } from '@/components/ResultCards';
import { colors, fonts } from '@/components/theme';
import { useAction } from '@/hooks/useAction';
import { useSession } from '@/hooks/useAuth';
import { useCountdown } from '@/hooks/useCountdown';
import { usePickLive } from '@/hooks/usePickLive';
import { usePickRoute } from '@/hooks/usePickRoute';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { useProgressToasts } from '@/hooks/useProgressToasts';
import { finalistsOf, useReveal } from '@/hooks/useReveal';
import { api } from '@/lib/api';
import { confirmAction } from '@/lib/confirm';
import { haptic } from '@/lib/haptics';
import { ordinal } from '@/lib/places';
import { voteLine } from '@/lib/pickUi';

export default function VoteScreen() {
  const { id: pickId = '' } = useLocalSearchParams<{ id: string }>();
  const session = useSession();
  const live = usePickLive(pickId);
  const pull = usePullToRefresh(live.refresh);
  usePickRoute(pickId, 'vote', live.state);
  const { reveal, retry } = useReveal(pickId, session.user.id, live.state);
  const action = useAction();
  const { toast } = useProgressToasts(live.progress);
  const countdown = useCountdown(live.deadline);
  // Optimistic: my tap shows at once; the server copy wins after a reload.
  const [picked, setPicked] = useState<string | null | undefined>(undefined);

  const myVote = picked !== undefined ? picked : reveal.status === 'ready' ? reveal.myVote : null;
  const progress = live.progress;
  const isHost = !!progress?.participants.find((p) => p.isMe)?.isHost;

  const vote = (placeId: string) => {
    if (placeId === myVote) return;
    haptic.tap();
    const before = myVote;
    setPicked(placeId);
    void action
      .run('vote', async () => {
        await api.vote(pickId, placeId);
        haptic.success();
      })
      .then((ok) => {
        if (!ok) setPicked(before);
        void live.refresh();
      });
  };

  const closeVote = async () => {
    const ok = await confirmAction({
      title: 'Close the vote now?',
      message: 'We’ll count the votes in. A tie goes to the higher-ranked place.',
      confirmLabel: 'Close vote',
    });
    if (ok && (await action.run('close', () => api.closeVote(pickId)))) void live.refresh();
  };

  if (reveal.status === 'error') {
    return (
      <SafeAreaView style={pickStyles.screen}>
        <PickTopBar title="Final vote" />
        <CenterMessage emoji="📡" title="Couldn’t load the finalists" body={reveal.message}>
          <GradientButton label="Try again" onPress={retry} />
          <Button label="Back to your Picks" variant="link" onPress={goToPicks} />
        </CenterMessage>
      </SafeAreaView>
    );
  }
  if (reveal.status === 'loading') {
    return (
      <SafeAreaView style={pickStyles.screen}>
        <View style={styles.center}>
          <FlameOrb emoji="🗳️" />
        </View>
      </SafeAreaView>
    );
  }

  const finalists = finalistsOf(reveal.ranking);
  const mine = myVote ? reveal.places.get(myVote) : undefined;

  return (
    <SafeAreaView style={pickStyles.screen} edges={['top', 'left', 'right', 'bottom']}>
      <PickTopBar
        title="Final vote"
        subtitle={[progress ? voteLine(progress) : null, countdown.label]
          .filter(Boolean)
          .join(' · ')}
        right={<LiveDot mode={live.mode} offline={!!live.error} />}
      />
      <ScrollView contentContainerStyle={pickStyles.scroll} refreshControl={pull}>
        <Animated.View entering={FadeInUp.duration(400)} style={styles.head}>
          <Text style={pickStyles.eyebrow}>TAP YOUR FAVORITE</Text>
          <Text style={pickStyles.heading} accessibilityRole="header">
            Where are we going? 🗳️
          </Text>
          <Text style={pickStyles.muted}>
            {mine
              ? `You voted for ${mine.name}. Tap another to change it.`
              : 'One vote each. You can change it until the vote closes.'}
          </Text>
        </Animated.View>

        {live.error ? (
          <ErrorBanner
            message={`${live.error} We’ll keep checking.`}
            onRetry={() => void live.refresh()}
          />
        ) : null}
        {action.error ? <ErrorBanner message={action.error} onRetry={action.clearError} /> : null}

        <View accessibilityRole="radiogroup" accessibilityLabel="Finalists" style={{ gap: 14 }}>
          {finalists.map((r, i) => {
            const p = reveal.places.get(r.placeId);
            if (!p) return null;
            const selected = r.placeId === myVote;
            return (
              <Animated.View key={r.placeId} entering={FadeInDown.delay(150 + i * 120).springify()}>
                <BigResult
                  place={p}
                  rank={r.rank}
                  selected={selected}
                  onPress={() => vote(r.placeId)}
                  accessibilityLabel={`${ordinal(r.rank)}: ${p.name}${selected ? ', your vote' : ''}`}
                  accessibilityHint={selected ? undefined : 'Votes for this place'}
                  footer={selected ? <Text style={styles.yourVote}>Your vote ✓</Text> : null}
                />
              </Animated.View>
            );
          })}
        </View>

        {progress ? (
          <View style={pickStyles.card}>
            <View style={styles.row}>
              <Text style={pickStyles.section}>{voteLine(progress)}</Text>
              <GroupAvatars people={progress.participants} mark="voted" size={28} />
            </View>
            <ProgressBar
              value={progress.votedCount}
              total={progress.total}
              accessibilityLabel={voteLine(progress)}
            />
          </View>
        ) : null}

        {isHost ? (
          <GradientButton
            label="Close the vote"
            accessibilityHint="Counts the votes now, before everyone has voted"
            loading={action.busy === 'close'}
            disabled={!!action.busy}
            onPress={() => void closeVote()}
          />
        ) : null}
        <Button label="Back to your Picks" variant="link" onPress={goToPicks} />
      </ScrollView>
      {toast ? <ActivityToast key={toast.id} toast={toast} /> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  head: { alignItems: 'center', gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  yourVote: { fontFamily: fonts.bold, fontSize: 14, color: colors.yes },
});
