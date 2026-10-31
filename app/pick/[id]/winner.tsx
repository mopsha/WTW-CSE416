// Winner (completed): the place, how it was decided, Directions in the phone's maps app, and
// "Saved to your history" (the decided Pick stays in the Picks list after reopening the app).
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams } from 'expo-router';
import { Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeInUp, ZoomIn } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { Confetti } from '@/components/Confetti';
import { GradientButton } from '@/components/GradientButton';
import {
  CenterMessage,
  FlameOrb,
  goToPicks,
  GroupAvatars,
  pickStyles,
} from '@/components/PickParts';
import { PlanBlock } from '@/components/PlanBlock';
import { SmallResult, WinnerCard } from '@/components/ResultCards';
import { colors, fonts } from '@/components/theme';
import { useSession } from '@/hooks/useAuth';
import { usePickLive } from '@/hooks/usePickLive';
import { usePickRoute } from '@/hooks/usePickRoute';
import { useReveal } from '@/hooks/useReveal';
import { haptic } from '@/lib/haptics';
import { directionsUrl } from '@/lib/pickUi';
import type { Candidate, DecidedBy } from '@/lib/types';

const HOW: Record<DecidedBy, { eyebrow: string; title: string; body: string }> = {
  clear_winner: {
    eyebrow: 'CLEAR WINNER',
    title: 'Everyone agrees 🔥',
    body: 'It came out on top by a mile, so we skipped the vote.',
  },
  vote: { eyebrow: 'THE GROUP VOTED', title: 'Decided! 🔥', body: 'The final vote settled it.' },
  tie_break: {
    eyebrow: 'TIE-BREAK',
    title: 'Decided! 🔥',
    body: 'The vote was tied, so the higher-ranked place won.',
  },
};

function openDirections(place: Candidate) {
  haptic.tap();
  void Linking.openURL(directionsUrl(place, Platform.OS)).catch(() => {});
}

export default function WinnerScreen() {
  const { id: pickId = '' } = useLocalSearchParams<{ id: string }>();
  const session = useSession();
  const live = usePickLive(pickId);
  usePickRoute(pickId, 'winner', live.state);
  const { reveal, retry } = useReveal(pickId, session.user.id, live.state);

  if (reveal.status === 'error') {
    return (
      <SafeAreaView style={pickStyles.screen}>
        <CenterMessage emoji="📡" title="Couldn’t load the winner" body={reveal.message}>
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
          <FlameOrb />
        </View>
      </SafeAreaView>
    );
  }

  const { pick, places, ranking } = reveal;
  const winner = pick.winnerPlaceId ? places.get(pick.winnerPlaceId) : undefined;
  if (!winner) {
    return (
      <SafeAreaView style={pickStyles.screen}>
        <CenterMessage emoji="🤔" title="No winner yet" body="Give it a moment.">
          <GradientButton label="Check again" onPress={retry} />
          <Button label="Back to your Picks" variant="link" onPress={goToPicks} />
        </CenterMessage>
      </SafeAreaView>
    );
  }

  const how = HOW[pick.decidedBy ?? 'vote'];
  const runnersUp = ranking.filter((r) => r.placeId !== winner.placeId).slice(0, 2);
  const people = live.progress?.participants ?? [];

  return (
    <View style={pickStyles.screen}>
      <LinearGradient
        colors={['#4A0F2A', colors.bg]}
        locations={[0, 0.6]}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={pickStyles.scroll}>
          <Animated.View entering={FadeInUp.duration(500)} style={styles.head}>
            <Text style={pickStyles.eyebrow}>{how.eyebrow}</Text>
            <Text style={pickStyles.heading} accessibilityRole="header">
              {how.title}
            </Text>
            <Text style={pickStyles.muted}>{how.body}</Text>
          </Animated.View>

          <Animated.View entering={ZoomIn.delay(200).springify()}>
            <WinnerCard place={winner} badge="👑 The pick" />
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(450)} style={{ gap: 10 }}>
            <GradientButton
              label="Let’s go 🚗  Get directions"
              accessibilityHint={`Opens ${Platform.OS === 'ios' ? 'Apple Maps' : 'Google Maps'}`}
              onPress={() => openDirections(winner)}
            />
            <View style={styles.saved} accessible accessibilityLabel="Saved to your history">
              <Ionicons name="checkmark-circle" size={18} color={colors.yes} />
              <Text style={styles.savedText}>Saved to your history</Text>
            </View>
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(550)}>
            <PlanBlock pickId={pickId} decidedAt={pick.decidedAt} />
          </Animated.View>

          {people.length ? (
            <Animated.View entering={FadeInDown.delay(600)} style={styles.group}>
              <GroupAvatars people={people} size={34} />
              <Text style={styles.groupText}>
                {people.length === 2 ? 'Both of you are in' : `All ${people.length} of you are in`}
              </Text>
            </Animated.View>
          ) : null}

          {runnersUp.length ? (
            <Animated.View entering={FadeInDown.delay(750)} style={{ gap: 10 }}>
              <Text style={pickStyles.section}>Also loved</Text>
              {runnersUp.map((r) => {
                const p = places.get(r.placeId);
                return p ? (
                  <SmallResult
                    key={r.placeId}
                    place={p}
                    rank={r.rank}
                    onPress={() => openDirections(p)}
                  />
                ) : null;
              })}
            </Animated.View>
          ) : null}

          <Button label="Back to your Picks" variant="link" onPress={goToPicks} />
        </ScrollView>
      </SafeAreaView>
      <Confetti />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  head: { alignItems: 'center', gap: 4 },
  saved: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 32,
  },
  savedText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.text },
  group: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  groupText: { fontFamily: fonts.bold, fontSize: 15, color: colors.text },
});
