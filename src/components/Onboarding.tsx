import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Screen } from './Screen';
import { colors, MIN_TARGET, radius, space, type } from './theme';

type IconName = keyof typeof Ionicons.glyphMap;

export interface IllustrationBadge {
  icon: IconName;
  color: string;
}

const BADGE_SLOTS = [
  { top: 6, left: 4 },
  { top: 6, right: 4 },
  { bottom: 10, right: 18 },
] as const;

/** A large decorative icon in layered circles, with up to three small colored badges. */
export function Illustration({
  icon,
  badges = [],
  size = 200,
}: {
  icon: IconName;
  badges?: IllustrationBadge[];
  size?: number;
}) {
  return (
    <View
      style={[styles.art, { width: size, height: size, borderRadius: size / 2 }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View
        style={[
          styles.artInner,
          { width: size * 0.7, height: size * 0.7, borderRadius: (size * 0.7) / 2 },
        ]}
      >
        <Ionicons name={icon} size={size * 0.4} color={colors.primary} />
      </View>
      {badges.slice(0, BADGE_SLOTS.length).map((b, i) => (
        <View key={b.icon} style={[styles.badge, BADGE_SLOTS[i], { backgroundColor: b.color }]}>
          <Ionicons name={b.icon} size={24} color={colors.bg} />
        </View>
      ))}
    </View>
  );
}

/**
 * Page or step dots. Screen readers hear "Page 1 of 3"; with `onChange` it is adjustable, so
 * VoiceOver/TalkBack users can swipe up/down to change page without the horizontal scroller.
 */
export function PageDots({
  index,
  total,
  noun = 'Page',
  onChange,
}: {
  index: number;
  total: number;
  noun?: string;
  onChange?: (index: number) => void;
}) {
  const label = `${noun} ${index + 1} of ${total}`;
  return (
    <View
      style={styles.dots}
      accessible
      accessibilityRole={onChange ? 'adjustable' : 'text'}
      accessibilityLabel={label}
      accessibilityActions={onChange ? [{ name: 'increment' }, { name: 'decrement' }] : undefined}
      onAccessibilityAction={(e) => {
        if (!onChange) return;
        const next = e.nativeEvent.actionName === 'increment' ? index + 1 : index - 1;
        if (next >= 0 && next < total) onChange(next);
      }}
    >
      {Array.from({ length: total }, (_, i) => (
        <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
      ))}
    </View>
  );
}

/** Title + one line of text, centered under the illustration. */
export function OnboardingCopy({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.copy}>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      <Text style={styles.body}>{body}</Text>
    </View>
  );
}

/**
 * One idea per screen: optional top row, big illustration, title, one line, optional extra
 * content, then the actions pinned low. Scrolls when large text needs more room.
 */
export function OnboardingFrame({
  top,
  art,
  title,
  body,
  children,
  actions,
}: {
  top?: ReactNode;
  art: ReactNode;
  title: string;
  body: string;
  children?: ReactNode;
  actions: ReactNode;
}) {
  return (
    <Screen contentStyle={styles.frame}>
      {top ? <View style={styles.top}>{top}</View> : null}
      <View style={styles.center}>
        {art}
        <OnboardingCopy title={title} body={body} />
        {children ? <View style={styles.extra}>{children}</View> : null}
      </View>
      <View style={styles.actions}>{actions}</View>
    </Screen>
  );
}

export const onboardingStyles = StyleSheet.create({
  input: {
    ...type.body,
    color: colors.text,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: space.xl - 2,
    paddingVertical: space.md,
    minHeight: MIN_TARGET + 6,
  },
  fine: { ...type.caption, color: colors.muted, textAlign: 'center' },
});

const styles = StyleSheet.create({
  frame: { flexGrow: 1, justifyContent: 'space-between', gap: space.xl },
  top: {
    minHeight: MIN_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  center: { alignItems: 'center', gap: space.xl, paddingVertical: space.lg },
  extra: { alignSelf: 'stretch', gap: space.md },
  actions: { gap: space.sm },
  art: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  artInner: { backgroundColor: colors.cardHi, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.bg,
  },
  copy: { gap: space.sm, alignItems: 'center' },
  title: { ...type.title, color: colors.text, textAlign: 'center' },
  body: { ...type.body, color: colors.muted, textAlign: 'center', maxWidth: 340 },
  dots: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    minHeight: MIN_TARGET,
    paddingHorizontal: space.md,
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  dotActive: { width: 24, backgroundColor: colors.primary },
});
