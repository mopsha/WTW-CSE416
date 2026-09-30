import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AvatarStack } from '@/components/Avatars';
import { ErrorBanner } from '@/components/ErrorBanner';
import { GradientButton } from '@/components/GradientButton';
import { PlacePhoto } from '@/components/PlaceCard';
import { colors, flame, fonts } from '@/components/theme';
import { useSession } from '@/hooks/useAuth';
import { auth } from '@/lib/auth';
import { USE_MOCK } from '@/lib/config';
import { messageOf } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { MOCK_PLACES } from '@/lib/mock/fixtures';
import { resetMockData } from '@/lib/mock/store';
import { queries } from '@/lib/queries';
import type { PickSummary } from '@/lib/types';

// Collage photos for the Pick card (the same cuisine photos the deck uses).
const COLLAGE = [0, 15, 12].map((i) => MOCK_PLACES[i]?.photoUrl ?? null);

function titleFor(p: PickSummary) {
  return p.category === 'activities' ? 'Friday night plans 🎳' : 'Dinner near campus 🍜';
}

function open(p: PickSummary) {
  haptic.tap();
  if (p.state === 'swiping') router.push({ pathname: '/pick/[id]/swipe', params: { id: p.id } });
  else if (p.state === 'ranking' || p.state === 'final_vote' || p.state === 'completed') {
    router.push({ pathname: '/pick/[id]/results', params: { id: p.id } });
  }
}

function firstName(email: string | null) {
  const local = (email ?? '').split('@')[0] ?? '';
  const word = local.split(/[^a-zA-Z]/)[0] ?? '';
  return word.length >= 2 ? word[0]!.toUpperCase() + word.slice(1) : 'there';
}

function LivePill() {
  const o = useSharedValue(1);
  useEffect(() => {
    o.value = withRepeat(withTiming(0.25, { duration: 700 }), -1, true);
  }, [o]);
  const dot = useAnimatedStyle(() => ({ opacity: o.value }));
  return (
    <View style={styles.live}>
      <Animated.View style={[styles.liveDot, dot]} />
      <Text style={styles.liveText}>LIVE</Text>
    </View>
  );
}

function PickCard({ pick, hero }: { pick: PickSummary; hero: boolean }) {
  const cta =
    pick.state === 'swiping'
      ? 'Start swiping'
      : pick.state === 'draft' || pick.state === 'canceled'
        ? null
        : 'See results';
  const status =
    pick.state === 'swiping'
      ? null
      : pick.state === 'final_vote'
        ? 'Final vote 🗳️'
        : pick.state === 'completed'
          ? 'Decided ✅'
          : pick.state === 'ranking'
            ? 'Ranking…'
            : pick.state === 'draft'
              ? 'Not started'
              : 'Canceled';

  return (
    <Pressable
      onPress={() => open(pick)}
      // The hero card has its own CTA button inside; only the compact cards are tappable.
      disabled={!cta || hero}
      accessible={!hero}
      accessibilityRole={hero ? undefined : 'button'}
      accessibilityLabel={`${titleFor(pick)}. ${status ?? 'Swiping now'}`}
      style={({ pressed }) => [styles.pickCard, pressed && { transform: [{ scale: 0.985 }] }]}
    >
      {hero ? (
        <View style={styles.collage}>
          <PlacePhoto uri={COLLAGE[0] ?? null} style={styles.collageBig} />
          <View style={styles.collageCol}>
            <PlacePhoto uri={COLLAGE[1] ?? null} style={styles.collageSmall} />
            <PlacePhoto uri={COLLAGE[2] ?? null} style={styles.collageSmall} />
          </View>
          <LinearGradient
            colors={['transparent', 'rgba(27,22,34,0.95)']}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.collageTop}>
            {pick.state === 'swiping' ? <LivePill /> : <Text style={styles.status}>{status}</Text>}
          </View>
        </View>
      ) : null}
      <View style={styles.pickBody}>
        <Text style={styles.pickTitle}>{titleFor(pick)}</Text>
        <Text style={styles.pickSub}>20 spots near SBU · you + 3 friends</Text>
        <View style={styles.pickRow}>
          <AvatarStack size={32} />
          {!hero && status ? <Text style={styles.status}>{status}</Text> : null}
        </View>
        {hero && cta ? <GradientButton label={cta} onPress={() => open(pick)} /> : null}
      </View>
    </Pressable>
  );
}

export default function HomeScreen() {
  const session = useSession();
  const [picks, setPicks] = useState<PickSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setPicks(await queries.listMyPicks(session.user.id));
    } catch (e) {
      setError(messageOf(e));
    }
  }, [session.user.id]);

  // Reload whenever Home comes back into focus (e.g. after swiping or ranking).
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const [first, ...rest] = picks ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.primary}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
      >
        <View style={styles.header}>
          <Pressable
            onLongPress={() => {
              // Hidden demo reset (mock mode only): long-press the logo.
              if (!USE_MOCK) return;
              haptic.success();
              resetMockData();
              void load();
            }}
            accessibilityRole="image"
            accessibilityLabel="WTW"
          >
            <LinearGradient
              colors={flame}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.logo}
            >
              <Text style={styles.logoText}>wtw</Text>
            </LinearGradient>
          </Pressable>
          <Pressable
            onPress={() => void auth.signOut()}
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            style={styles.iconBtn}
          >
            <Ionicons name="log-out-outline" size={22} color={colors.muted} />
          </Pressable>
        </View>

        <View style={{ gap: 4 }}>
          <Text style={styles.hello}>Hey {firstName(session.user.email)} 👋</Text>
          <Text style={styles.h1} accessibilityRole="header">
            What&apos;s the word tonight?
          </Text>
        </View>

        {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

        {picks === null && !error ? (
          <ActivityIndicator style={{ marginTop: 40 }} size="large" color={colors.primary} />
        ) : first ? (
          <>
            <PickCard pick={first} hero />
            {rest.length ? <Text style={styles.section}>More Picks</Text> : null}
            {rest.map((p) => (
              <PickCard key={p.id} pick={p} hero={false} />
            ))}
          </>
        ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>🍽️</Text>
            <Text style={styles.emptyText}>
              No Picks yet. When a friend invites you, it shows up here.
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, gap: 18, paddingBottom: 40 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  logo: {
    width: 48,
    height: 48,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-8deg' }],
  },
  logoText: { fontFamily: fonts.black, fontSize: 18, color: '#FFFFFF', letterSpacing: -0.5 },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
  },
  hello: { fontFamily: fonts.medium, fontSize: 16, color: colors.muted },
  h1: { fontFamily: fonts.black, fontSize: 30, lineHeight: 36, color: colors.text },
  section: { fontFamily: fonts.bold, fontSize: 18, color: colors.text, marginTop: 6 },
  pickCard: {
    backgroundColor: colors.card,
    borderRadius: 28,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  collage: { height: 210, flexDirection: 'row', gap: 3 },
  collageBig: { flex: 2 },
  collageCol: { flex: 1, gap: 3 },
  collageSmall: { flex: 1 },
  collageTop: { position: 'absolute', top: 14, left: 14 },
  pickBody: { padding: 18, gap: 10 },
  pickTitle: { fontFamily: fonts.black, fontSize: 22, color: colors.text },
  pickSub: { fontFamily: fonts.medium, fontSize: 14, color: colors.muted },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  live: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(14,11,18,0.75)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF3D71' },
  liveText: { fontFamily: fonts.black, fontSize: 12, letterSpacing: 1.5, color: '#FFFFFF' },
  status: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.text,
    backgroundColor: 'rgba(14,11,18,0.75)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    overflow: 'hidden',
  },
  empty: { alignItems: 'center', gap: 10, marginTop: 40 },
  emptyEmoji: { fontSize: 44 },
  emptyText: { fontFamily: fonts.medium, fontSize: 15, color: colors.muted, textAlign: 'center' },
});
