// Results reveal: what everyone sees the moment the Pick closes. RANK ONLY (1st/2nd/3rd with
// photo, name, price, open-now badge). A clear winner says so and skips the vote; otherwise
// the top picks go to a quick vote.
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { Confetti } from '@/components/Confetti';
import { GradientButton } from '@/components/GradientButton';
import {
  CenterMessage,
  FlameOrb,
  goToPicks,
  GroupAvatars,
  PickTopBar,
  pickStyles,
} from '@/components/PickParts';
import { BigResult, SmallResult, WinnerCard } from '@/components/ResultCards';
import { colors } from '@/components/theme';
import { useSession } from '@/hooks/useAuth';
import { usePickLive } from '@/hooks/usePickLive';
import { usePickRoute } from '@/hooks/usePickRoute';
import { finalistsOf, useReveal } from '@/hooks/useReveal';
import { haptic } from '@/lib/haptics';

export default function ResultsScreen() {
  const { id: pickId = '' } = useLocalSearchParams<{ id: string }>();
  const session = useSession();
  const live = usePickLive(pickId);
  usePickRoute(pickId, 'results', live.state);
  const { reveal, retry } = useReveal(pickId, session.user.id, live.state);

  const state = live.state ?? (reveal.status === 'ready' ? reveal.pick.state : null);
  const ready = reveal.status === 'ready' && state !== 'ranking';

  useEffect(() => {
    if (ready) haptic.success();
  }, [ready]);

  const go = (screen: 'vote' | 'winner') =>
    router.replace({ pathname: `/pick/[id]/${screen}`, params: { id: pickId } });

  if (reveal.status === 'error') {
    return (
      <SafeAreaView style={pickStyles.screen}>
        <PickTopBar title="Results" />
        <CenterMessage emoji="📡" title="Couldn’t load the results" body={reveal.message}>
          <GradientButton label="Try again" onPress={retry} />
          <Button label="Back to your Picks" variant="link" onPress={goToPicks} />
        </CenterMessage>
      </SafeAreaView>
    );
  }

  if (reveal.status === 'loading' || state === 'ranking' || state === null) {
    return (
      <SafeAreaView style={pickStyles.screen}>
        <View style={styles.counting}>
          <FlameOrb />
          <Text style={pickStyles.heading}>Counting everyone&apos;s swipes…</Text>
          {live.progress ? <GroupAvatars people={live.progress.participants} size={36} /> : null}
        </View>
      </SafeAreaView>
    );
  }

  const { pick, places, ranking } = reveal;
  const people = live.progress?.participants ?? [];
  const clear = pick.decidedBy === 'clear_winner';
  const voting = state === 'final_vote';
  const winner = pick.winnerPlaceId ? places.get(pick.winnerPlaceId) : undefined;
  const top3 = ranking.slice(0, 3);

  if (!voting && !winner && top3.length === 0) {
    return (
      <SafeAreaView style={pickStyles.screen}>
        <PickTopBar title="Results" />
        <CenterMessage emoji="🤔" title="Results aren’t ready yet" body="Give it a moment.">
          <GradientButton label="Check again" onPress={retry} />
        </CenterMessage>
      </SafeAreaView>
    );
  }

  return (
    <View style={pickStyles.screen}>
      <LinearGradient
        colors={[voting ? '#2A1640' : '#4A0F2A', colors.bg]}
        locations={[0, 0.6]}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={pickStyles.scroll}>
          <Animated.View entering={FadeInUp.duration(500)} style={styles.head}>
            <Text style={pickStyles.eyebrow}>
              {voting ? 'TOO CLOSE TO CALL' : clear ? 'CLEAR WINNER!' : 'THE GROUP PICKED'}
            </Text>
            <Text style={pickStyles.heading} accessibilityRole="header">
              {voting ? 'It’s a tie-breaker 👀' : clear ? 'Everyone agrees 🔥' : 'Decided! 🔥'}
            </Text>
            <Text style={pickStyles.muted}>
              {voting
                ? 'Your top picks were neck and neck. One quick vote decides it.'
                : clear
                  ? 'One place ran away with it, so there’s no vote.'
                  : 'Here’s how the group ranked them.'}
            </Text>
          </Animated.View>

          {voting ? (
            finalistsOf(ranking).map((r, i) => {
              const p = places.get(r.placeId);
              return p ? (
                <Animated.View
                  key={r.placeId}
                  entering={FadeInDown.delay(250 + i * 150).springify()}
                >
                  <BigResult place={p} rank={r.rank} />
                </Animated.View>
              ) : null;
            })
          ) : (
            <>
              {winner ? (
                <Animated.View entering={FadeInDown.delay(250).springify()}>
                  <WinnerCard place={winner} />
                </Animated.View>
              ) : null}
              {top3
                .filter((r) => r.placeId !== pick.winnerPlaceId)
                .map((r, i) => {
                  const p = places.get(r.placeId);
                  return p ? (
                    <Animated.View key={r.placeId} entering={FadeInDown.delay(450 + i * 120)}>
                      <SmallResult place={p} rank={r.rank} />
                    </Animated.View>
                  ) : null;
                })}
            </>
          )}

          {people.length ? (
            <Animated.View entering={FadeInDown.delay(700)} style={styles.group}>
              <GroupAvatars people={people} size={34} />
            </Animated.View>
          ) : null}

          <Animated.View entering={FadeInDown.delay(800)} style={{ gap: 8 }}>
            {voting ? (
              <GradientButton label="Vote now 🗳️" onPress={() => go('vote')} />
            ) : (
              <GradientButton label="Let’s go 🚗  See the winner" onPress={() => go('winner')} />
            )}
            <Button label="Back to your Picks" variant="link" onPress={goToPicks} />
          </Animated.View>
        </ScrollView>
      </SafeAreaView>
      {!voting ? <Confetti /> : <Confetti count={30} />}
    </View>
  );
}

const styles = StyleSheet.create({
  counting: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18, padding: 24 },
  head: { alignItems: 'center', gap: 4 },
  group: { alignItems: 'center' },
});
