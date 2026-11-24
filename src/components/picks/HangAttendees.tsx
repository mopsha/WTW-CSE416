import { Ionicons } from '@expo/vector-icons';
import type { HangAttendance, HangPerson, HangPost } from '@shared/api/hang.ts';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components';
import { Sheet } from '@/components/TabUi';
import { colors, MIN_TARGET, picksTheme, radius, space, type } from '@/components/theme';

const categories = [
  { status: 'down', label: 'Down', empty: 'No one is down yet.' },
  { status: 'maybe', label: 'Maybe', empty: 'No maybes yet.' },
] as const;
const personName = (person: HangPerson) =>
  person.displayName?.trim() || person.username || 'WTW member';

export function HangAttendees({
  post,
  onOpenProfile,
}: {
  post: HangPost;
  onOpenProfile(id: string): void;
}) {
  const [tab, setTab] = useState<HangAttendance | null>(null);
  const sheet = useRef<{ phase: 'closed' | 'open' } | { phase: 'closing'; userId?: string }>({
    phase: 'closed',
  });
  const downCount = post.downCount ?? 0;
  const maybeCount = post.maybeCount ?? 0;
  const groups = categories.map((category) => ({
    ...category,
    people: (post.attendees ?? []).filter((person) => person.status === category.status),
    count: category.status === 'down' ? downCount : maybeCount,
  }));
  const active = groups.find((group) => group.status === tab);

  const preview = groups.flatMap(({ people }) => people).slice(0, 3);
  const summary = `${downCount} down · ${maybeCount} maybe`;

  const closeSheet = (userId?: string) => {
    if (sheet.current.phase !== 'open') return;
    sheet.current = { phase: 'closing', userId };
    setTab(null);
  };

  return (
    <View style={s.section}>
      <View style={s.summaryRow}>
        {preview.map((person) => (
          <Pressable
            key={person.userId}
            accessibilityRole="button"
            accessibilityLabel={`Open ${personName(person)}’s profile`}
            onPress={() => {
              if (sheet.current.phase === 'closed') onOpenProfile(person.userId);
            }}
            style={({ pressed }) => [s.previewTarget, pressed && s.pressed]}
          >
            <View
              pointerEvents="none"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={s.previewAvatar}
            >
              <Avatar name={personName(person)} userId={person.userId} size={MIN_TARGET - 2} />
            </View>
          </Pressable>
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`View attendees, ${downCount} down, ${maybeCount} maybe`}
          accessibilityHint="Opens the attendee list"
          onPress={() => {
            if (sheet.current.phase !== 'closed') return;
            sheet.current = { phase: 'open' };
            setTab(!downCount && maybeCount ? 'maybe' : 'down');
          }}
          style={({ pressed }) => [s.summary, pressed && s.pressed]}
        >
          <Text style={s.summaryText}>{summary}</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.muted} accessible={false} />
        </Pressable>
      </View>
      <Sheet
        visible={tab !== null}
        title="Who's coming?"
        onClose={() => closeSheet()}
        onDismiss={() => {
          if (sheet.current.phase !== 'closing') return;
          const { userId } = sheet.current;
          sheet.current = { phase: 'closed' };
          if (userId && post.attendees?.some((person) => person.userId === userId)) {
            onOpenProfile(userId);
          }
        }}
      >
        {active ? (
          <>
            <View style={s.tabs} accessibilityRole="tablist">
              {groups.map(({ status, label, count }) => (
                <Pressable
                  key={status}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: tab === status }}
                  accessibilityLabel={`${label}, ${count}`}
                  onPress={() => {
                    if (sheet.current.phase === 'open') setTab(status);
                  }}
                  style={[s.tab, tab === status && s.selectedTab]}
                >
                  <Text style={[s.label, tab === status && s.accent]}>
                    {label} · {count}
                  </Text>
                </Pressable>
              ))}
            </View>
            {active.people.length ? (
              active.people.map((person) => (
                <Pressable
                  key={person.userId}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${personName(person)}’s profile${person.username ? `, @${person.username}` : ''}`}
                  onPress={() => closeSheet(person.userId)}
                  style={({ pressed }) => [s.person, pressed && s.pressed]}
                >
                  <Avatar name={personName(person)} userId={person.userId} size={40} />
                  <View style={s.personText}>
                    <Text style={s.label}>{personName(person)}</Text>
                    {person.username ? <Text style={s.caption}>@{person.username}</Text> : null}
                  </View>
                </Pressable>
              ))
            ) : (
              <Text style={s.empty}>
                {active.count ? 'Attendee details are unavailable.' : active.empty}
              </Text>
            )}
          </>
        ) : null}
      </Sheet>
    </View>
  );
}

const s = StyleSheet.create({
  section: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  summaryRow: { flexDirection: 'row', alignItems: 'center', minHeight: MIN_TARGET + 4 },
  previewTarget: {
    width: MIN_TARGET,
    height: MIN_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The rims overlap while the buttons keep separate touch bounds.
  previewAvatar: {
    borderWidth: 3,
    borderColor: picksTheme.colors.invitation,
    backgroundColor: picksTheme.colors.invitation,
    borderRadius: radius.pill,
  },
  summary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: MIN_TARGET,
    paddingVertical: space.xs,
    paddingLeft: space.sm,
  },
  summaryText: { ...type.caption, color: colors.text, flex: 1, minWidth: 0 },
  tabs: { flexDirection: 'row', gap: space.sm, marginBottom: space.sm },
  tab: {
    flex: 1,
    minHeight: MIN_TARGET,
    padding: space.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.card,
  },
  selectedTab: { backgroundColor: picksTheme.colors.coralQuiet },
  person: {
    minHeight: MIN_TARGET,
    paddingVertical: space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  personText: { flex: 1, minWidth: 0 },
  label: { ...type.body, color: colors.text },
  accent: { color: colors.primary },
  caption: { ...type.caption, color: colors.muted },
  empty: { ...type.body, color: colors.muted, paddingVertical: space.lg },
  pressed: { opacity: 0.75 },
});
