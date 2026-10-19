import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeInDown,
  FadeInUp,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  ZoomIn,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AvatarStack } from '@/components/Avatars';
import { Button } from '@/components/Button';
import { Confetti } from '@/components/Confetti';
import { ErrorBanner } from '@/components/ErrorBanner';
import { GradientButton } from '@/components/GradientButton';
import { Chips, PlacePhoto } from '@/components/PlaceCard';
import { colors, flame, fonts } from '@/components/theme';
import { useSession } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { messageOf } from '@/lib/errors';
import { useEnrichedPlace } from '@/lib/googlePlaces';
import { haptic } from '@/lib/haptics';
import { ordinal } from '@/lib/places';
import { queries } from '@/lib/queries';
import {
  shouldRequestRank,
  viewFromDecision,
  viewFromStored,
  type ResultsView,
} from '@/lib/results';
import type { Candidate, RankPosition } from '@/lib/types';

// Users see RANK ONLY. Nothing on this screen may show a score; neither the API nor our
// queries return one.

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      view: ResultsView;
      places: Map<string, Candidate>;
      runnersUp: RankPosition[];
    };

/** The host of a swiping Pick ranks it (POST /rank); everyone else reads what's stored. */
async function loadResults(pickId: string, userId: string) {
  const started = Date.now();
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
  const [candidates, ranking] = await Promise.all([
    queries.getCandidates(pickId),
    view.kind === 'winner' ? queries.getRankingResults(pickId) : Promise.resolve([]),
  ]);
  const runnersUp =
    view.kind === 'winner'
      ? ranking
          .filter((r) => r.placeId !== view.placeId && r.rank <= 3)
          .sort((a, b) => a.rank - b.rank)
          .map(({ placeId, rank }) => ({ placeId, rank }))
      : [];
  // A beat of suspense for the reveal.
  const wait = 1600 - (Date.now() - started);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  return { view, places: new Map(candidates.map((c) => [c.placeId, c])), runnersUp };
}

const WAITING_COPY = {
  host: {
    emoji: '⏳',
    title: 'Waiting for the host',
    body: 'Results drop once the host closes swiping. Your answers stay private until then.',
  },
  ranking: {
    emoji: '🧮',
    title: 'Ranking in progress…',
    body: 'This usually takes a few seconds.',
  },
  not_started: { emoji: '🕒', title: 'Not started yet', body: 'Check back once swiping opens.' },
} as const;

function directions(place: Candidate) {
  haptic.tap();
  const q = encodeURIComponent([place.name, place.address].filter(Boolean).join(', '));
  void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${q}`);
}

function Counting() {
  const s = useSharedValue(1);
  useEffect(() => {
    s.value = withRepeat(
      withSequence(withTiming(1.15, { duration: 450 }), withTiming(1, { duration: 450 })),
      -1,
    );
  }, [s]);
  const pulse = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <View style={styles.centerFill}>
      <Animated.View style={pulse}>
        <LinearGradient
          colors={flame}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.orb}
        >
          <Text style={styles.orbText}>🔥</Text>
        </LinearGradient>
      </Animated.View>
      <Text style={styles.countTitle}>Counting everyone&apos;s swipes…</Text>
      <AvatarStack size={36} />
    </View>
  );
}

export default function ResultsScreen() {
  const { id: pickId = '' } = useLocalSearchParams<{ id: string }>();
  const session = useSession();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    loadResults(pickId, session.user.id).then(
      (ready) => {
        if (!active) return;
        if (ready.view.kind === 'winner' || ready.view.kind === 'vote') haptic.success();
        setLoad({ status: 'ready', ...ready });
      },
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
      <SafeAreaView style={styles.screen}>
        <Counting />
      </SafeAreaView>
    );
  }
  if (load.status === 'error') {
    return (
      <SafeAreaView style={[styles.screen, { padding: 20 }]}>
        <ErrorBanner message={load.message} onRetry={retry} />
        <Button label="Back to your Picks" variant="link" onPress={home} />
      </SafeAreaView>
    );
  }

  const { view, places, runnersUp } = load;

  if (view.kind === 'waiting' || view.kind === 'canceled' || view.kind === 'empty') {
    const copy =
      view.kind === 'waiting'
        ? WAITING_COPY[view.reason]
        : view.kind === 'canceled'
          ? { emoji: '🚫', title: 'This Pick was canceled', body: 'Start a new one anytime.' }
          : { emoji: '🤔', title: 'Results aren’t ready yet', body: 'Give it a moment.' };
    return (
      <SafeAreaView style={styles.screen}>
        <View style={[styles.centerFill, { padding: 24 }]}>
          <Text style={{ fontSize: 64 }}>{copy.emoji}</Text>
          <Text style={styles.countTitle}>{copy.title}</Text>
          <Text style={styles.muted}>{copy.body}</Text>
          {view.kind !== 'canceled' ? (
            <GradientButton label="Check again" onPress={retry} style={{ alignSelf: 'stretch' }} />
          ) : null}
          <Button label="Back to your Picks" variant="link" onPress={home} />
        </View>
      </SafeAreaView>
    );
  }

  if (view.kind === 'winner') {
    const winner = places.get(view.placeId);
    return (
      <View style={styles.screen}>
        <LinearGradient
          colors={['#4A0F2A', colors.bg]}
          locations={[0, 0.6]}
          style={StyleSheet.absoluteFill}
        />
        <SafeAreaView style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={styles.content}>
            <Animated.View
              entering={FadeInUp.duration(500)}
              style={{ alignItems: 'center', gap: 2 }}
            >
              <Text style={styles.eyebrow}>
                {view.clearWinner ? 'CLEAR WINNER' : 'THE GROUP PICKED'}
              </Text>
              <Text style={styles.wtw} accessibilityRole="header">
                {view.clearWinner ? 'Everyone agrees 🔥' : 'Decided! 🔥'}
              </Text>
            </Animated.View>
            {winner ? (
              <Animated.View entering={ZoomIn.delay(250).springify()} style={styles.winnerWrap}>
                <LinearGradient
                  colors={flame}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.winnerRing}
                >
                  <WinnerCard place={winner} />
                </LinearGradient>
              </Animated.View>
            ) : null}
            <Animated.View entering={FadeInDown.delay(600)} style={styles.groupRow}>
              <AvatarStack size={34} />
              <Text style={styles.groupText}>All 4 of you are in</Text>
            </Animated.View>
            {winner ? (
              <Animated.View entering={FadeInDown.delay(750)} style={{ gap: 10 }}>
                <GradientButton
                  label="Let's go 🚗  Get directions"
                  onPress={() => directions(winner)}
                />
              </Animated.View>
            ) : null}
            {runnersUp.length ? (
              <Animated.View entering={FadeInDown.delay(900)} style={{ gap: 10 }}>
                <Text style={styles.section}>Also loved</Text>
                {runnersUp.map((r) => {
                  const p = places.get(r.placeId);
                  return p ? <SmallResult key={r.placeId} place={p} rank={r.rank} /> : null;
                })}
              </Animated.View>
            ) : null}
            <Button label="Back to your Picks" variant="link" onPress={home} />
          </ScrollView>
        </SafeAreaView>
        <Confetti />
      </View>
    );
  }

  // Final vote: no clear winner; show the finalists by rank (the vote itself is M3).
  return (
    <View style={styles.screen}>
      <LinearGradient
        colors={['#2A1640', colors.bg]}
        locations={[0, 0.6]}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content}>
          <Animated.View entering={FadeInUp.duration(500)} style={{ alignItems: 'center', gap: 4 }}>
            <Text style={styles.eyebrow}>TOO CLOSE TO CALL</Text>
            <Text style={styles.wtw} accessibilityRole="header">
              It&apos;s a tie-breaker 👀
            </Text>
            <Text style={styles.muted}>Your top picks. The group votes next.</Text>
          </Animated.View>
          {view.finalists.map((r, i) => {
            const p = places.get(r.placeId);
            return p ? (
              <Animated.View key={r.placeId} entering={FadeInDown.delay(250 + i * 150).springify()}>
                <BigResult place={p} rank={r.rank} />
              </Animated.View>
            ) : null;
          })}
          <Button label="Back to your Picks" variant="link" onPress={home} />
        </ScrollView>
      </SafeAreaView>
      <Confetti count={30} />
    </View>
  );
}

function WinnerCard({ place: base }: { place: Candidate }) {
  const place = useEnrichedPlace(base);
  return (
    <View style={styles.winnerCard}>
      <PlacePhoto uri={place.photoUrl} style={styles.winnerPhoto} />
      <View style={styles.crown}>
        <Text style={styles.crownText}>👑 1st</Text>
      </View>
      <View style={styles.winnerInfo}>
        <Text style={styles.winnerName}>{place.name}</Text>
        {place.address ? <Text style={styles.addr}>{place.address}</Text> : null}
        <Chips place={place} light={false} />
        {place.photoCredit ? <Text style={styles.credit}>Photo: {place.photoCredit}</Text> : null}
      </View>
    </View>
  );
}

function BigResult({ place: base, rank }: { place: Candidate; rank: number }) {
  const place = useEnrichedPlace(base);
  return (
    <Pressable
      onPress={() => directions(place)}
      accessibilityRole="button"
      accessibilityLabel={`${ordinal(rank)}: ${place.name}. Opens directions.`}
      style={styles.bigResult}
    >
      <PlacePhoto uri={place.photoUrl} style={styles.bigPhoto} />
      <LinearGradient
        colors={['transparent', 'rgba(8,6,12,0.92)']}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.rankBadge}>
        <Text style={styles.rankText}>{ordinal(rank)}</Text>
      </View>
      <View style={styles.bigInfo}>
        <Text style={styles.bigName}>{place.name}</Text>
        <Chips place={place} />
      </View>
    </Pressable>
  );
}

function SmallResult({ place: base, rank }: { place: Candidate; rank: number }) {
  const place = useEnrichedPlace(base);
  return (
    <Pressable
      onPress={() => directions(place)}
      accessibilityRole="button"
      accessibilityLabel={`${ordinal(rank)}: ${place.name}. Opens directions.`}
      style={styles.small}
    >
      <PlacePhoto uri={place.photoUrl} style={styles.smallPhoto} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.smallRank}>{ordinal(rank)}</Text>
        <Text style={styles.smallName} numberOfLines={1}>
          {place.name}
        </Text>
        {place.cuisine ? <Text style={styles.smallMeta}>{place.cuisine}</Text> : null}
      </View>
      <Ionicons name="navigate" size={20} color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, gap: 18, paddingBottom: 40 },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18 },
  orb: {
    width: 110,
    height: 110,
    borderRadius: 55,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbText: { fontSize: 52 },
  countTitle: { fontFamily: fonts.black, fontSize: 24, color: colors.text, textAlign: 'center' },
  muted: { fontFamily: fonts.medium, fontSize: 14, color: colors.muted, textAlign: 'center' },
  eyebrow: { fontFamily: fonts.black, fontSize: 13, letterSpacing: 3, color: '#FF7A45' },
  wtw: {
    fontFamily: fonts.black,
    fontSize: 36,
    lineHeight: 44,
    color: colors.text,
    textAlign: 'center',
  },
  winnerWrap: {
    shadowColor: '#FF3D71',
    shadowOpacity: 0.55,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 12 },
    elevation: 14,
  },
  winnerRing: { borderRadius: 30, padding: 3 },
  winnerCard: { borderRadius: 27, overflow: 'hidden', backgroundColor: colors.card },
  winnerPhoto: { width: '100%', height: 260 },
  crown: {
    position: 'absolute',
    top: 14,
    left: 14,
    backgroundColor: 'rgba(14,11,18,0.8)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  crownText: { fontFamily: fonts.black, fontSize: 14, color: '#FFD23F' },
  winnerInfo: { padding: 18, gap: 6 },
  credit: { fontFamily: fonts.medium, fontSize: 10, color: colors.muted },
  addr: { fontFamily: fonts.medium, fontSize: 14, color: colors.muted },
  winnerName: { fontFamily: fonts.black, fontSize: 28, lineHeight: 34, color: colors.text },
  groupRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  groupText: { fontFamily: fonts.bold, fontSize: 15, color: colors.text },
  section: { fontFamily: fonts.bold, fontSize: 18, color: colors.text },
  bigResult: { height: 190, borderRadius: 24, overflow: 'hidden', backgroundColor: colors.card },
  bigPhoto: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  rankBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    backgroundColor: 'rgba(14,11,18,0.8)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
  },
  rankText: { fontFamily: fonts.black, fontSize: 14, color: '#FFD23F' },
  bigInfo: { position: 'absolute', left: 16, right: 16, bottom: 14, gap: 4 },
  bigName: { fontFamily: fonts.black, fontSize: 22, color: '#FFFFFF' },
  small: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    borderRadius: 20,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  smallPhoto: { width: 64, height: 64, borderRadius: 14 },
  smallRank: { fontFamily: fonts.black, fontSize: 12, color: '#FF7A45', letterSpacing: 1 },
  smallName: { fontFamily: fonts.bold, fontSize: 16, color: colors.text },
  smallMeta: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted },
});
