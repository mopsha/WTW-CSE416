import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Screen } from '@/components';
import { HangCard } from '@/components/HangCard';
import { JoinCodeCard } from '@/components/JoinCodeCard';
import { NotificationBell } from '@/components/NotificationBell';
import { HeaderAction, ListRow, QuietEmpty, SectionHeading, Sheet } from '@/components/TabUi';
import { ErrorBanner } from '@/components/ErrorBanner';
import { colors, fonts, MIN_TARGET, radius, space, surfaces, type } from '@/components/theme';
import { useSession } from '@/hooks/useAuth';
import { USE_MOCK } from '@/lib/config';
import { messageOf } from '@/lib/errors';
import { memberCountLabel, newGroupPickRoute, type GroupSummary } from '@/lib/groups';
import { haptic } from '@/lib/haptics';
import { resetMockGroups } from '@/lib/mock/groups';
import { MOCK_INVITE_CODE, resetMockData } from '@/lib/mock/store';
import { pickTitle, STATE_LABEL } from '@/lib/pickUi';
import { queries } from '@/lib/queries';
import type { PickState, PickSummary } from '@/lib/types';
const ACTIVE: readonly PickState[] = ['draft', 'swiping', 'ranking', 'final_vote'];
function PickRow({ pick }: { pick: PickSummary }) {
  return (
    <ListRow
      title={pickTitle(pick.category)}
      subtitle={STATE_LABEL[pick.state]}
      leading={
        <Ionicons
          name={
            pick.category === 'food'
              ? 'restaurant-outline'
              : pick.category === 'custom'
                ? 'sparkles-outline'
                : 'walk-outline'
          }
          size={25}
          color={colors.primary}
        />
      }
      onPress={() => {
        haptic.tap();
        router.push({ pathname: '/pick/[id]', params: { id: pick.id } });
      }}
    />
  );
}
export default function PicksScreen() {
  const session = useSession();
  const [picks, setPicks] = useState<PickSummary[] | null>(null);
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [joining, setJoining] = useState(false);
  const load = useCallback(async () => {
    setError(null);
    try {
      setPicks(await queries.listMyPicks(session.user.id));
    } catch (e) {
      setError(messageOf(e));
    }
    setGroups(await queries.listMyGroups(session.user.id).catch(() => []));
  }, [session.user.id]);
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
  return (
    <Screen
      edges={['top', 'left', 'right']}
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        void load().finally(() => setRefreshing(false));
      }}
    >
      <View style={s.header}>
        <Pressable
          onLongPress={USE_MOCK ? resetDemo : undefined}
          accessibilityRole="image"
          accessibilityLabel="WTW"
          style={s.wordmarkTarget}
        >
          <Text style={s.wordmark}>wtw</Text>
        </Pressable>
        <View style={s.actions}>
          <NotificationBell />
          <HeaderAction
            icon="add-outline"
            label="Create a Pick"
            onPress={() => router.push('/pick/new')}
          />
        </View>
      </View>
      <View style={s.intro}>
        <Text style={s.headline} accessibilityRole="header">
          What’s the <Text style={s.accent}>word?</Text>
        </Text>
        <Text style={s.subtitle}>Decide where to eat or what to do{'\n'}with your friends.</Text>
      </View>
      <Button
        label="Start a Pick"
        icon="sparkles-outline"
        onPress={() => router.push('/pick/new')}
        style={s.start}
      />
      <Pressable
        onPress={() => setJoining(true)}
        accessibilityRole="button"
        accessibilityLabel="Join with code"
        style={({ pressed }) => [s.join, pressed && { opacity: 0.7 }]}
      >
        <Ionicons name="qr-code-outline" size={22} color={colors.text} />
        <Text style={s.joinText}>Join with code</Text>
        <Ionicons name="chevron-forward" size={19} color={colors.muted} />
      </Pressable>
      <View style={s.section}>
        <SectionHeading
          title="Your groups"
          right={
            <Button
              label={groups.length ? 'All groups' : 'New group'}
              variant="link"
              onPress={() => router.push('/groups')}
            />
          }
        />
        {groups.length ? (
          <View style={s.groupList}>
            {groups.slice(0, 3).map((g) => (
              <View key={g.id} style={s.groupRow}>
                <Pressable
                  onPress={() => router.push({ pathname: '/groups/[id]', params: { id: g.id } })}
                  accessibilityRole="button"
                  accessibilityLabel={`${g.name}, ${memberCountLabel(g.memberCount)}`}
                  style={s.groupMain}
                >
                  <View style={s.groupIcon}>
                    <Ionicons name="people-outline" size={23} color={colors.muted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.groupName}>{g.name}</Text>
                    <Text style={s.caption}>{memberCountLabel(g.memberCount)}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.muted} />
                </Pressable>
                <Button
                  label="Start"
                  variant="link"
                  accessibilityLabel={`Start a Pick with ${g.name}`}
                  onPress={() => router.push(newGroupPickRoute(g))}
                />
              </View>
            ))}
          </View>
        ) : (
          <Text style={s.caption}>Make a group for your regular crew.</Text>
        )}
      </View>
      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
      {picks === null && !error ? (
        <ActivityIndicator color={colors.primary} accessibilityLabel="Loading your Picks" />
      ) : null}
      {active.length ? (
        <View>
          <SectionHeading title="Active Picks" />
          {active.map((p) => (
            <PickRow key={p.id} pick={p} />
          ))}
        </View>
      ) : picks ? (
        <QuietEmpty
          icon="calendar-outline"
          title="No active picks"
          body="Start a Pick with a group to decide where to eat or what to do."
        />
      ) : null}
      <HangCard />
      {history.length ? (
        <View>
          <SectionHeading title="History" />
          {history.map((p) => (
            <PickRow key={p.id} pick={p} />
          ))}
          <Button
            label="See winners, who went, and Pick again"
            variant="link"
            onPress={() => router.push('/history')}
          />
        </View>
      ) : null}
      {USE_MOCK ? (
        <View style={s.demo}>
          <Text style={s.caption}>Demo mode · local data · join code {MOCK_INVITE_CODE}</Text>
          <Button label="Reset demo" icon="refresh-outline" variant="link" onPress={resetDemo} />
        </View>
      ) : null}
      <Sheet title="Join with code" visible={joining} onClose={() => setJoining(false)}>
        <JoinCodeCard onJoined={() => setJoining(false)} />
      </Sheet>
    </Screen>
  );
}
const s = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: space.md,
  },
  actions: { flexDirection: 'row', gap: space.xs },
  wordmarkTarget: { minHeight: MIN_TARGET, justifyContent: 'center' },
  wordmark: { fontFamily: fonts.bold, fontSize: 29, letterSpacing: -1.5, color: colors.text },
  intro: { gap: space.sm, marginBottom: space.xs },
  headline: { ...type.title, fontSize: 32, letterSpacing: -0.8, color: colors.text },
  accent: { color: colors.primary },
  subtitle: { ...type.body, fontSize: 17, lineHeight: 25, color: colors.muted },
  start: { minHeight: 56 },
  join: {
    ...surfaces.control,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 52,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
  },
  joinText: { ...type.body, color: colors.text, flex: 1 },
  section: { gap: space.sm },
  groupList: { ...surfaces.control, borderRadius: radius.md, overflow: 'hidden' },
  groupRow: { flexDirection: 'row', alignItems: 'center', ...surfaces.line },
  groupMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    minHeight: 72,
  },
  groupIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.sm,
    backgroundColor: colors.cardHi,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupName: { ...type.body, fontFamily: fonts.semibold, color: colors.text },
  caption: { ...type.caption, color: colors.muted },
  demo: { paddingTop: space.lg, gap: space.xs },
});
