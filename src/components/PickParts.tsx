// Building blocks shared by the Pick screens (lobby, swipe, waiting, results, vote, winner),
// in the live-demo look: dark surfaces, flame gradient, Poppins.
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import type { LiveMode } from '@/hooks/usePickLive';
import type { ParticipantProgress } from '@/lib/types';

import { Avatar } from './Avatar';
import { colors, flame, fonts, MIN_TARGET } from './theme';

/** Leave the Pick flow for the Picks tab, whatever stack of replaced screens is underneath. */
export function goToPicks() {
  if (router.canDismiss()) router.dismissTo('/');
  else router.replace('/');
}

/** The demo's top bar: round back button, centered title + subtitle, optional right slot. */
export function PickTopBar({
  title,
  subtitle,
  right,
  onBack = goToPicks,
}: {
  title: string;
  subtitle?: string | null;
  right?: ReactNode;
  onBack?: () => void;
}) {
  return (
    <View style={styles.topBar}>
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Back to your Picks"
        style={styles.iconBtn}
        hitSlop={4}
      >
        <Ionicons name="chevron-back" size={24} color={colors.text} />
      </Pressable>
      <View style={styles.topText}>
        <Text style={styles.topTitle} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.topSub} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={styles.right}>{right}</View>
    </View>
  );
}

/** Live (Realtime) vs. polling vs. offline, so nobody wonders why the screen isn't moving. */
export function LiveDot({ mode, offline }: { mode: LiveMode; offline?: boolean }) {
  const label = offline
    ? 'Offline'
    : mode === 'realtime'
      ? 'Live'
      : mode === 'polling'
        ? 'Updating'
        : '…';
  const color = offline ? colors.danger : mode === 'realtime' ? colors.yes : colors.maybe;
  const o = useSharedValue(1);
  useEffect(() => {
    o.value = withRepeat(
      withSequence(withTiming(0.3, { duration: 700 }), withTiming(1, { duration: 700 })),
      -1,
    );
  }, [o]);
  const pulse = useAnimatedStyle(() => ({ opacity: o.value }));
  return (
    <View
      style={styles.live}
      accessible
      accessibilityLabel={
        offline
          ? 'Offline. Retrying.'
          : mode === 'realtime'
            ? 'Live updates on'
            : 'Checking for updates every few seconds'
      }
    >
      <Animated.View style={[styles.liveDot, { backgroundColor: color }, pulse]} />
      <Text style={styles.liveText}>{label}</Text>
    </View>
  );
}

/** A participant row: avatar (check when done), name, host tag, and a status on the right. */
export function ParticipantRow({
  person,
  status,
  right,
}: {
  person: ParticipantProgress;
  /** e.g. "Done", "Swiping…", "Voted". Never what they answered. */
  status?: string | null;
  /** A control after the row (e.g. MemberMenu), outside its single accessibility label. */
  right?: ReactNode;
}) {
  const name =
    person.isMe && person.displayName !== 'You'
      ? `${person.displayName} (you)`
      : person.displayName;
  const row = (
    <View
      style={[styles.person, right ? { flex: 1 } : null]}
      accessible
      accessibilityLabel={[name, person.isHost ? 'host' : null, status].filter(Boolean).join(', ')}
    >
      <Avatar name={person.displayName} size={40} done={person.done} />
      <Text style={styles.personName} numberOfLines={1}>
        {name}
      </Text>
      {person.isHost ? (
        <View style={styles.hostTag}>
          <Text style={styles.hostText}>HOST</Text>
        </View>
      ) : null}
      {status ? <Text style={styles.personStatus}>{status}</Text> : null}
    </View>
  );
  if (!right) return row;
  return (
    <View style={styles.personWithAction}>
      {row}
      {right}
    </View>
  );
}

/** Overlapping avatars of the group, with checks for anyone done. */
export function GroupAvatars({
  people,
  size = 32,
  mark = 'done',
}: {
  people: readonly ParticipantProgress[];
  size?: number;
  mark?: 'done' | 'voted';
}) {
  return (
    <View
      style={styles.stack}
      accessible
      accessibilityLabel={`${people.length} ${people.length === 1 ? 'person' : 'people'}`}
    >
      {people.slice(0, 6).map((p, i) => (
        <View key={p.userId} style={[styles.ring, i > 0 && { marginLeft: -size * 0.3 }]}>
          <Avatar name={p.displayName} size={size} done={mark === 'done' ? p.done : p.voted} />
        </View>
      ))}
      {people.length > 6 ? (
        <Text style={[styles.more, { marginLeft: 6 }]}>+{people.length - 6}</Text>
      ) : null}
    </View>
  );
}

/** The pulsing flame orb the demo used while counting swipes. */
export function FlameOrb({ emoji = '🔥', size = 110 }: { emoji?: string; size?: number }) {
  const s = useSharedValue(1);
  useEffect(() => {
    s.value = withRepeat(
      withSequence(withTiming(1.12, { duration: 450 }), withTiming(1, { duration: 450 })),
      -1,
    );
  }, [s]);
  const pulse = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <Animated.View style={pulse} accessible={false}>
      <LinearGradient
        colors={flame}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ fontSize: size * 0.47 }}>{emoji}</Text>
      </LinearGradient>
    </Animated.View>
  );
}

/** A full-screen message: big emoji, title, body, then whatever actions. */
export function CenterMessage({
  emoji,
  title,
  body,
  children,
}: {
  emoji?: string;
  title: string;
  body?: string | null;
  children?: ReactNode;
}) {
  return (
    <View style={styles.center}>
      {emoji ? <Text style={styles.emoji}>{emoji}</Text> : null}
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
      {children ? <View style={styles.actions}>{children}</View> : null}
    </View>
  );
}

/** A pill like "⏱ 12:04 left". */
export function Pill({
  icon,
  text,
  tone = 'muted',
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  text: string;
  tone?: 'muted' | 'warn' | 'good';
}) {
  const color = tone === 'warn' ? '#FF7A45' : tone === 'good' ? colors.yes : colors.muted;
  return (
    <View style={styles.pill}>
      {icon ? <Ionicons name={icon} size={14} color={color} /> : null}
      <Text style={[styles.pillText, { color }]}>{text}</Text>
    </View>
  );
}

export const pickStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1, paddingHorizontal: 16, paddingBottom: 16, gap: 14 },
  scroll: { padding: 16, gap: 16, paddingBottom: 40 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    gap: 12,
  },
  eyebrow: { fontFamily: fonts.black, fontSize: 13, letterSpacing: 3, color: '#FF7A45' },
  heading: {
    fontFamily: fonts.black,
    fontSize: 30,
    lineHeight: 38,
    color: colors.text,
    textAlign: 'center',
  },
  section: { fontFamily: fonts.bold, fontSize: 18, color: colors.text },
  muted: {
    fontFamily: fonts.medium,
    fontSize: 15,
    lineHeight: 21,
    color: colors.muted,
    textAlign: 'center',
  },
});

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 4,
    paddingBottom: 6,
  },
  iconBtn: {
    width: MIN_TARGET,
    height: MIN_TARGET,
    borderRadius: MIN_TARGET / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
  },
  topText: { flex: 1, alignItems: 'center' },
  topTitle: { fontFamily: fonts.bold, fontSize: 17, color: colors.text },
  topSub: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted, textAlign: 'center' },
  right: { minWidth: MIN_TARGET, alignItems: 'flex-end' },
  live: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    minHeight: 28,
    borderRadius: 999,
    backgroundColor: colors.card,
  },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  liveText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.text },
  person: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 },
  personWithAction: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  personName: { flexShrink: 1, fontFamily: fonts.semibold, fontSize: 16, color: colors.text },
  personStatus: { marginLeft: 'auto', fontFamily: fonts.medium, fontSize: 13, color: colors.muted },
  hostTag: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: colors.cardHi,
  },
  hostText: { fontFamily: fonts.black, fontSize: 10, letterSpacing: 1.5, color: '#FF7A45' },
  stack: { flexDirection: 'row', alignItems: 'center' },
  ring: { borderRadius: 999, borderWidth: 2, borderColor: colors.bg },
  more: { fontFamily: fonts.bold, fontSize: 13, color: colors.muted },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 },
  emoji: { fontSize: 64 },
  title: {
    fontFamily: fonts.black,
    fontSize: 26,
    lineHeight: 32,
    color: colors.text,
    textAlign: 'center',
  },
  body: {
    fontFamily: fonts.medium,
    fontSize: 15,
    lineHeight: 21,
    color: colors.muted,
    textAlign: 'center',
  },
  actions: { alignSelf: 'stretch', gap: 8, marginTop: 6 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    minHeight: 30,
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillText: { fontFamily: fonts.semibold, fontSize: 13 },
});
