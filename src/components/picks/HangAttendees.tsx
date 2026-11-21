import type { HangAttendance, HangPerson, HangPost } from '@shared/api/hang.ts';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components';
import { Sheet } from '@/components/TabUi';
import { colors, MIN_TARGET, picksTheme, radius, space, type } from '@/components/theme';

const categories = [
  { status: 'down', label: 'Down', empty: 'No one is down yet.' },
  { status: 'maybe', label: 'Maybe', empty: 'No maybes yet.' },
] as const;
const personName = (person: HangPerson) => person.displayName ?? person.username ?? 'WTW member';

function openProfile(id: string, hangId: string) {
  router.push({ pathname: '/users/[id]', params: { id, hangId } });
}

export function HangAttendees({ post }: { post: HangPost }) {
  const [tab, setTab] = useState<HangAttendance | null>(null);
  const profileAfterDismiss = useRef<string | null>(null);
  const groups = categories.map((category) => ({
    ...category,
    people: (post.attendees ?? []).filter((person) => person.status === category.status),
    count: (category.status === 'down' ? post.downCount : post.maybeCount) ?? 0,
  }));
  const active = groups.find((group) => group.status === tab);

  return (
    <View style={s.section}>
      {groups.map(({ status, label, count, people }) => (
        <View key={status} style={s.preview}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`View ${label} attendees, ${count}`}
            onPress={() => setTab(status)}
            style={s.category}
          >
            <Text style={[s.label, status === 'down' && s.accent]}>{label}</Text>
            <Text style={s.caption}>{count}</Text>
          </Pressable>
          <View style={s.faces}>
            {people.slice(0, 4).map((person, index) => (
              <Pressable
                key={person.userId}
                accessibilityRole="button"
                accessibilityLabel={`Open ${personName(person)}’s profile`}
                onPress={() => openProfile(person.userId, post.id)}
                style={[s.faceTarget, index > 0 && s.overlap]}
              >
                <View style={s.avatarFrame}>
                  <Avatar name={personName(person)} userId={person.userId} size={40} />
                </View>
              </Pressable>
            ))}
            {count > 4 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`View all ${count} ${label} attendees`}
                onPress={() => setTab(status)}
                style={s.overflow}
              >
                <Text style={s.caption}>+{count - 4}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ))}
      <Sheet
        visible={tab !== null}
        title="Who's coming?"
        onClose={() => setTab(null)}
        onDismiss={() => {
          const id = profileAfterDismiss.current;
          profileAfterDismiss.current = null;
          if (id) openProfile(id, post.id);
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
                  onPress={() => setTab(status)}
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
                  onPress={() => {
                    profileAfterDismiss.current = person.userId;
                    setTab(null);
                  }}
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
  preview: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  category: {
    minHeight: MIN_TARGET,
    minWidth: MIN_TARGET,
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingRight: space.sm,
  },
  faces: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  faceTarget: {
    width: MIN_TARGET,
    height: MIN_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlap: { marginLeft: -space.sm },
  avatarFrame: { borderWidth: 2, borderColor: colors.card, borderRadius: MIN_TARGET },
  overflow: {
    minWidth: MIN_TARGET,
    minHeight: MIN_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
