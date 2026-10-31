// Picks (home), in the live-demo style: the newest active Pick as a photo-collage hero card,
// other active Picks below, and decided/canceled ones under History (the saved results).
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

import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { ErrorBanner } from '@/components/ErrorBanner';
import { GradientButton } from '@/components/GradientButton';
import { JoinCodeCard } from '@/components/JoinCodeCard';
import { PlacePhoto } from '@/components/PlaceCard';
import { colors, flame, fonts, MIN_TARGET } from '@/components/theme';
import { useSession } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { USE_MOCK } from '@/lib/config';
import { messageOf } from '@/lib/errors';
import { memberCountLabel, newGroupPickRoute, type GroupSummary } from '@/lib/groups';
import { haptic } from '@/lib/haptics';
import { MOCK_PLACES } from '@/lib/mock/fixtures';
import { resetMockGroups } from '@/lib/mock/groups';
import { MOCK_INVITE_CODE, resetMockData } from '@/lib/mock/store';
import { pickEmoji, pickTitle, STATE_LABEL } from '@/lib/pickUi';
import { queries } from '@/lib/queries';
import type { PickState, PickSummary } from '@/lib/types';

// Collage photos for the hero card (openly licensed cuisine photos; see docs/demo-photo-credits.md).
const COLLAGE = [0, 15, 12].map((i) => MOCK_PLACES[i]?.photoUrl ?? null);

const ACTIVE: readonly PickState[] = ['draft', 'swiping', 'ranking', 'final_vote'];

const CTA: Record<PickState, string> = {
  draft: 'Open the lobby',
  swiping: 'Start swiping',
  ranking: 'See results',
  final_vote: 'Vote now 🗳️',
  completed: 'See the winner',
  canceled: 'View',
};

const STATUS_COLOR: Record<PickState, string> = {
  draft: colors.muted,
  swiping: colors.primary,
  ranking: colors.maybe,
  final_vote: colors.maybe,
  completed: colors.yes,
  canceled: colors.muted,
};

/** The Pick's entry screen sends you to its current step (lobby, deck, vote, winner…). */
function open(p: PickSummary) {
  haptic.tap();
  router.push({ pathname: '/pick/[id]', params: { id: p.id } });
}

function firstName(displayName: string | null, email: string | null) {
  // My chosen name's first word; before I've picked one, a guess from the email.
  const chosen = displayName?.trim().split(/\s+/)[0];
  if (chosen) return chosen;
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

function HeroCard({ pick }: { pick: PickSummary }) {
  return (
    <View style={styles.pickCard}>
      <View style={styles.collage} accessible={false}>
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
          {pick.state === 'swiping' ? (
            <LivePill />
          ) : (
            <Text style={styles.status}>{STATE_LABEL[pick.state]}</Text>
          )}
        </View>
      </View>
      <View style={styles.pickBody}>
        <Text style={styles.pickTitle} accessibilityRole="header">
          {pickTitle(pick.category)} {pickEmoji(pick.category)}
        </Text>
        <Text style={styles.pickSub}>{STATE_LABEL[pick.state]}</Text>
        <GradientButton
          label={CTA[pick.state]}
          accessibilityHint={`Opens your ${pickTitle(pick.category)}`}
          onPress={() => open(pick)}
        />
      </View>
    </View>
  );
}

function PickRow({ pick }: { pick: PickSummary }) {
  return (
    <Pressable
      onPress={() => open(pick)}
      accessibilityRole="button"
      accessibilityLabel={`${pickTitle(pick.category)}, ${STATE_LABEL[pick.state]}`}
      style={({ pressed }) => [
        styles.row,
        pick.state === 'canceled' && { opacity: 0.55 },
        pressed && { transform: [{ scale: 0.985 }] },
      ]}
    >
      <View style={styles.rowIcon}>
        <Text style={{ fontSize: 22 }}>{pickEmoji(pick.category)}</Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.rowTitle}>{pickTitle(pick.category)}</Text>
        <View style={styles.rowStatus}>
          <View style={[styles.dot, { backgroundColor: STATUS_COLOR[pick.state] }]} />
          <Text style={styles.rowState}>{STATE_LABEL[pick.state]}</Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.muted} />
    </Pressable>
  );
}

/** Start a Pick for a group in one tap (then "Create Pick" opens the Lobby with everyone in). */
function GroupsShortcut({ groups }: { groups: GroupSummary[] }) {
  return (
    <View style={{ gap: 10 }}>
      <View style={styles.sectionRow}>
        <Text style={styles.section} accessibilityRole="header">
          Your groups
        </Text>
        <Button
          label={groups.length ? 'All groups' : 'New group'}
          variant="link"
          onPress={() => router.push('/groups')}
        />
      </View>
      {groups.slice(0, 3).map((g) => (
        <View key={g.id} style={styles.row}>
          <View style={styles.rowIcon}>
            <Ionicons name="people" size={22} color={colors.text} />
          </View>
          <Pressable
            style={{ flex: 1, gap: 2, minHeight: MIN_TARGET, justifyContent: 'center' }}
            onPress={() => router.push({ pathname: '/groups/[id]', params: { id: g.id } })}
            accessibilityRole="button"
            accessibilityLabel={`${g.name}, ${memberCountLabel(g.memberCount)}`}
            accessibilityHint="Opens the group"
          >
            <Text style={styles.rowTitle}>{g.name}</Text>
            <Text style={styles.rowState}>{memberCountLabel(g.memberCount)}</Text>
          </Pressable>
          <Button
            label="Start"
            icon="flame"
            variant="secondary"
            onPress={() => {
              haptic.tap();
              router.push(newGroupPickRoute(g));
            }}
            accessibilityLabel={`Start a Pick with ${g.name}`}
          />
        </View>
      ))}
    </View>
  );
}

export default function PicksScreen() {
  const session = useSession();
  const { displayName } = useProfile();
  const [picks, setPicks] = useState<PickSummary[] | null>(null);
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setPicks(await queries.listMyPicks(session.user.id));
    } catch (e) {
      setError(messageOf(e));
    }
    // Groups are a shortcut here; if they fail to load, Picks still work.
    setGroups(await queries.listMyGroups(session.user.id).catch(() => []));
  }, [session.user.id]);

  // Reload whenever Picks comes back into focus (e.g. after a Pick is decided).
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const resetDemo = () => {
    haptic.success();
    resetMockData();
    resetMockGroups();
    void load();
  };

  const active = (picks ?? []).filter((p) => ACTIVE.includes(p.state));
  const history = (picks ?? []).filter((p) => !ACTIVE.includes(p.state));
  const [hero, ...more] = active;

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
            // Hidden demo reset (mock mode only): long-press the logo.
            onLongPress={USE_MOCK ? resetDemo : undefined}
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
            onPress={() => router.push('/pick/new')}
            accessibilityRole="button"
            accessibilityLabel="Create a Pick"
            style={styles.iconBtn}
          >
            <Ionicons name="add" size={26} color={colors.text} />
          </Pressable>
        </View>

        <View style={{ gap: 4 }}>
          <Text style={styles.hello}>Hey {firstName(displayName, session.user.email)} 👋</Text>
          <Text style={styles.h1} accessibilityRole="header">
            What&apos;s the word tonight?
          </Text>
        </View>

        <JoinCodeCard />

        <GroupsShortcut groups={groups} />

        {USE_MOCK ? (
          <View style={styles.mock}>
            <Text style={styles.mockText}>
              Demo mode: data is local and resets on reload. Try joining with code{' '}
              {MOCK_INVITE_CODE}.
            </Text>
            <Button label="Reset demo" variant="secondary" icon="refresh" onPress={resetDemo} />
          </View>
        ) : null}

        {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

        {picks === null && !error ? (
          <ActivityIndicator
            style={{ marginTop: 40 }}
            size="large"
            color={colors.primary}
            accessibilityLabel="Loading your Picks"
          />
        ) : null}

        {picks && picks.length === 0 ? (
          <EmptyState
            emoji="🍽️"
            title="No Picks yet"
            body="Start one and invite friends, or join one with a code."
            action={{
              label: 'Create a Pick',
              icon: 'add',
              onPress: () => router.push('/pick/new'),
            }}
          />
        ) : null}

        {picks && picks.length > 0 && !hero ? (
          <GradientButton label="Start a new Pick 🔥" onPress={() => router.push('/pick/new')} />
        ) : null}

        {hero ? <HeroCard pick={hero} /> : null}
        {more.length ? <Text style={styles.section}>More Picks</Text> : null}
        {more.map((p) => (
          <PickRow key={p.id} pick={p} />
        ))}
        {history.length ? <Text style={styles.section}>History</Text> : null}
        {history.map((p) => (
          <PickRow key={p.id} pick={p} />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, gap: 16, paddingBottom: 40 },
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
    width: MIN_TARGET,
    height: MIN_TARGET,
    borderRadius: MIN_TARGET / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
  },
  hello: { fontFamily: fonts.medium, fontSize: 16, color: colors.muted },
  h1: { fontFamily: fonts.black, fontSize: 30, lineHeight: 36, color: colors.text },
  mock: { gap: 8, padding: 12, borderRadius: 18, backgroundColor: colors.infoBg },
  mockText: { fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  section: { fontFamily: fonts.bold, fontSize: 18, color: colors.text, marginTop: 6 },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pickCard: {
    backgroundColor: colors.card,
    borderRadius: 28,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  collage: { height: 200, flexDirection: 'row', gap: 3 },
  collageBig: { flex: 2 },
  collageCol: { flex: 1, gap: 3 },
  collageSmall: { flex: 1 },
  collageTop: { position: 'absolute', top: 14, left: 14 },
  pickBody: { padding: 18, gap: 10 },
  pickTitle: { fontFamily: fonts.black, fontSize: 22, color: colors.text },
  pickSub: { fontFamily: fonts.medium, fontSize: 14, color: colors.muted },
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    minHeight: 72,
    borderRadius: 22,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.cardHi,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: { fontFamily: fonts.bold, fontSize: 17, color: colors.text },
  rowStatus: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  rowState: { fontFamily: fonts.medium, fontSize: 14, color: colors.muted },
});
