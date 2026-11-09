import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { ActivePickPanel, GroupIdentity, PicksHero } from '@/components/picks/PicksHome';
import { Button, Screen } from '@/components';
import { HangCard } from '@/components/HangCard';
import { JoinCodeCard } from '@/components/JoinCodeCard';
import { NotificationBell } from '@/components/NotificationBell';
import { HeaderAction, ListRow, QuietEmpty, Sheet } from '@/components/TabUi';
import { ErrorBanner } from '@/components/ErrorBanner';
import { colors, fonts, MIN_TARGET, picksTheme, space, type } from '@/components/theme';
import { useSession } from '@/hooks/useAuth';
import { USE_MOCK } from '@/lib/config';
import { messageOf } from '@/lib/errors';
import { newGroupPickRoute, type GroupSummary } from '@/lib/groups';
import { haptic } from '@/lib/haptics';
import { resetMockGroups } from '@/lib/mock/groups';
import { MOCK_INVITE_CODE, resetMockData } from '@/lib/mock/store';
import { historyTitle, historySubtitle, recentHistory } from '@/lib/recentHistory';
import { queries } from '@/lib/queries';
import type { PickState, PickSummary } from '@/lib/types';
const ACTIVE: readonly PickState[] = ['draft', 'swiping', 'ranking', 'final_vote'];
function PickRow({ pick }: { pick: PickSummary }) {
  return (
    <ListRow
      title={historyTitle(pick)}
      titleNumberOfLines={2}
      subtitle={historySubtitle(pick)}
      leading={
        <Ionicons
          name={
            pick.category === 'food'
              ? 'restaurant-outline'
              : pick.category === 'custom'
                ? 'sparkles-outline'
                : 'walk-outline'
          }
          size={20}
          color={colors.muted}
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
  return <PicksHome key={session.user.id} userId={session.user.id} />;
}
function PicksHome({ userId }: { userId: string }) {
  const latest = useRef(0);
  const [picks, setPicks] = useState<PickSummary[] | null>(null);
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [joining, setJoining] = useState(false);
  const load = useCallback(async () => {
    const request = ++latest.current;
    setError(null);
    setGroupError(null);
    try {
      const next = await queries.listPicksHome(userId);
      if (request !== latest.current) return;
      setPicks(next);
    } catch (e) {
      if (request !== latest.current) return;
      setError(messageOf(e));
    }
    try {
      const next = await queries.listMyGroups(userId);
      if (request === latest.current) setGroups(next);
    } catch (e) {
      if (request === latest.current) setGroupError(messageOf(e));
    }
  }, [userId]);
  useFocusEffect(
    useCallback(() => {
      void load();
      return () => {
        latest.current++;
        setPicks(null);
        setGroups(null);
      };
    }, [load]),
  );
  const resetDemo = () => {
    haptic.success();
    resetMockData();
    resetMockGroups();
    void load();
  };
  const active = (picks ?? []).filter((p) => ACTIVE.includes(p.state));
  const history = recentHistory(picks ?? []);
  return (
    <Screen
      edges={['top', 'left', 'right']}
      contentStyle={s.content}
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
      <PicksHero />
      <View style={s.primaryActions}>
        <Button
          label="Start a Pick"
          variant="paper"
          icon="arrow-forward"
          onPress={() => router.push('/pick/new')}
        />
        <Pressable
          onPress={() => setJoining(true)}
          accessibilityRole="button"
          accessibilityLabel="Join with code"
          style={({ pressed }) => [s.join, pressed && { opacity: 0.7 }]}
        >
          <Ionicons name="qr-code-outline" size={18} color={colors.muted} />
          <Text style={s.joinText}>Join with code</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.muted} />
        </Pressable>
      </View>
      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
      {picks === null && !error ? (
        <ActivityIndicator color={colors.primary} accessibilityLabel="Loading your Picks" />
      ) : null}
      {active.length ? (
        <View style={s.section}>
          <Text style={s.sectionTitle} accessibilityRole="header">
            Active Picks
          </Text>
          {active.map((pick) => (
            <ActivePickPanel
              key={pick.id}
              pick={pick}
              onPress={() => {
                router.push({ pathname: '/pick/[id]', params: { id: pick.id } });
              }}
            />
          ))}
        </View>
      ) : picks ? (
        <QuietEmpty
          icon="calendar-outline"
          title="No active picks"
          body="Start a Pick with a group to decide where to eat or what to do."
        />
      ) : null}
      <View style={s.section}>
        <View style={s.sectionHead}>
          <Text style={s.sectionTitle} accessibilityRole="header">
            Your groups
          </Text>
          <Button
            label={groups?.length ? 'All groups' : 'New group'}
            variant="link"
            onPress={() => router.push('/groups')}
          />
        </View>
        {groupError ? <ErrorBanner message={groupError} onRetry={() => void load()} /> : null}
        {groups === null && !groupError ? (
          <ActivityIndicator color={colors.primary} accessibilityLabel="Loading your groups" />
        ) : null}
        {groups?.length ? (
          <View style={[s.groupShelf, groups.length === 1 && s.singleShelf]}>
            {groups.slice(0, 3).map((group) => (
              <GroupIdentity
                key={group.id}
                group={group}
                single={groups.length === 1}
                onOpen={() => router.push({ pathname: '/groups/[id]', params: { id: group.id } })}
                onStart={() => router.push(newGroupPickRoute(group))}
              />
            ))}
          </View>
        ) : groups !== null && !groupError ? (
          <Text style={s.caption}>Make a group for your regular crew.</Text>
        ) : null}
      </View>
      <HangCard />
      {picks !== null ? (
        <View>
          <View style={s.sectionHead}>
            <Text style={s.historyTitle} accessibilityRole="header">
              Recent History
            </Text>
            <Button label="See all" variant="link" onPress={() => router.push('/history')} />
          </View>
          {history.length ? (
            history.map((p) => <PickRow key={p.id} pick={p} />)
          ) : (
            <Text style={s.caption}>Your finished Picks will appear here.</Text>
          )}
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
  content: { paddingTop: space.sm, gap: space.lg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  actions: { flexDirection: 'row', gap: space.xs },
  wordmarkTarget: { minHeight: MIN_TARGET, minWidth: MIN_TARGET, justifyContent: 'center' },
  wordmark: { fontFamily: fonts.bold, fontSize: 25, letterSpacing: -1.3, color: colors.text },
  primaryActions: { gap: space.xs },
  join: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    minHeight: MIN_TARGET,
    paddingVertical: space.sm,
  },
  joinText: { ...picksTheme.secondary, color: colors.muted, flexShrink: 1 },
  section: { gap: space.md },
  sectionHead: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  historyTitle: { ...picksTheme.section, color: colors.muted },
  sectionTitle: { ...picksTheme.section, color: colors.text },
  groupShelf: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: space.md },
  singleShelf: { alignItems: 'stretch' },
  caption: { ...type.caption, color: colors.muted },
  demo: { paddingTop: space.lg, gap: space.xs },
});
