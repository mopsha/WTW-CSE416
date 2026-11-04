import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, Card } from '@/components';
import { colors, fonts, MIN_TARGET, picksTheme, radius, space } from '@/components/theme';
import { initialsFor } from '@/lib/avatar';
import { memberCountLabel, type GroupSummary } from '@/lib/groups';
import { pickTitle, STATE_LABEL } from '@/lib/pickUi';
import type { PickSummary } from '@/lib/types';

export function PicksHero() {
  return (
    <View
      style={s.hero}
      accessible
      accessibilityRole="header"
      accessibilityLabel="What’s the word?"
    >
      <Text style={s.lead}>What’s the</Text>
      <View style={s.speechWrap}>
        <View pointerEvents="none" style={s.backing} accessible={false} />
        <View style={s.speech}>
          <Text
            style={s.word}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.5}
            maxFontSizeMultiplier={1.5}
          >
            word?
          </Text>
        </View>
        <View pointerEvents="none" style={s.tail} accessible={false} />
      </View>
    </View>
  );
}

export function ActivePickPanel({ pick, onPress }: { pick: PickSummary; onPress(): void }) {
  const title = pickTitle(pick.category);
  const status = STATE_LABEL[pick.state];
  return (
    <Card
      variant="flat"
      style={s.active}
      onPress={onPress}
      accessibilityLabel={`${title}, ${status}`}
    >
      <View pointerEvents="none" style={s.activeEdge} />
      <View style={s.activeTop}>
        <View style={s.category}>
          <Ionicons
            name={
              pick.category === 'food'
                ? 'restaurant-outline'
                : pick.category === 'custom'
                  ? 'sparkles-outline'
                  : pick.category === 'both'
                    ? 'layers-outline'
                    : 'walk-outline'
            }
            size={20}
            color={colors.text}
          />
        </View>
        <View style={s.status}>
          <Text style={s.statusText}>{status}</Text>
        </View>
      </View>
      <View style={s.activeTitleRow}>
        <Text style={s.activeTitle}>{title}</Text>
        <Ionicons name="arrow-forward" size={23} color={colors.primary} />
      </View>
    </Card>
  );
}

export function GroupIdentity({
  group,
  single = false,
  onOpen,
  onStart,
}: {
  group: GroupSummary;
  single?: boolean;
  onOpen(): void;
  onStart(): void;
}) {
  return (
    <View style={[s.group, single && s.singleGroup]}>
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`${group.name}, ${memberCountLabel(group.memberCount)}`}
        style={({ pressed }) => [s.groupMain, single && s.singleMain, pressed && s.pressed]}
      >
        <View style={s.monogram} accessible={false}>
          <Text style={s.initials}>{initialsFor(group.name)}</Text>
        </View>
        <View style={[s.groupLabels, single && s.singleLabels]}>
          <Text style={[s.groupName, single && s.singleName]}>{group.name}</Text>
          <Text style={s.caption}>{memberCountLabel(group.memberCount)}</Text>
        </View>
      </Pressable>
      <Button
        label="Start"
        variant="link"
        accessibilityLabel={`Start a Pick with ${group.name}`}
        onPress={onStart}
      />
    </View>
  );
}

const s = StyleSheet.create({
  hero: { alignItems: 'flex-start', paddingBottom: space.sm, gap: space.xs },
  lead: {
    fontFamily: fonts.semibold,
    fontSize: 25,
    lineHeight: 34,
    color: colors.text,
    letterSpacing: -0.8,
  },
  speechWrap: { marginLeft: space.lg, maxWidth: '94%', flexShrink: 1, paddingBottom: space.sm },
  backing: {
    position: 'absolute',
    top: 5,
    bottom: 2,
    left: 5,
    right: -5,
    backgroundColor: picksTheme.colors.speechBacking,
    borderRadius: radius.lg,
  },
  speech: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    borderBottomLeftRadius: space.sm,
    paddingHorizontal: space.xl,
    paddingVertical: space.xs,
  },
  word: {
    fontFamily: fonts.black,
    fontSize: 64,
    lineHeight: 80,
    letterSpacing: -2.5,
    color: picksTheme.colors.ink,
  },
  tail: {
    position: 'absolute',
    bottom: 0,
    left: space.xl,
    width: 18,
    height: 18,
    backgroundColor: colors.primary,
    borderBottomRightRadius: 16,
  },
  active: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: space.lg,
    paddingLeft: space.xl,
    gap: space.sm,
    minHeight: 108,
  },
  activeEdge: {
    position: 'absolute',
    top: 22,
    bottom: 22,
    left: 0,
    width: 3,
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
  activeTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  category: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: colors.cardHi,
    alignItems: 'center',
    justifyContent: 'center',
  },
  status: {
    backgroundColor: picksTheme.colors.coralQuiet,
    borderRadius: radius.sm,
    paddingVertical: space.xs,
    paddingHorizontal: space.sm,
    flexShrink: 1,
  },
  statusText: { ...picksTheme.secondary, color: colors.text, fontWeight: '500' },
  activeTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  activeTitle: {
    fontFamily: fonts.semibold,
    fontSize: 21,
    lineHeight: 29,
    color: colors.text,
    flex: 1,
  },
  group: { flexBasis: 92, flexGrow: 1, alignItems: 'center', minWidth: 92 },
  groupMain: { alignItems: 'center', gap: space.sm, alignSelf: 'stretch', minHeight: MIN_TARGET },
  monogram: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: picksTheme.colors.monogram,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: { fontFamily: fonts.semibold, fontSize: 21, color: picksTheme.colors.paper },
  groupLabels: { alignItems: 'center', gap: 2, alignSelf: 'stretch' },
  groupName: { ...picksTheme.ui, fontWeight: '600', color: colors.text, textAlign: 'center' },
  caption: { ...picksTheme.secondary, color: colors.muted },
  singleGroup: {
    flexBasis: 'auto',
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: space.md,
    gap: space.sm,
  },
  singleMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md },
  singleLabels: { flex: 1, alignItems: 'flex-start', alignSelf: 'auto' },
  singleName: { textAlign: 'left' },
  pressed: { opacity: 0.7 },
});
