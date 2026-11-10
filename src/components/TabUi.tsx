import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, MIN_TARGET, radius, space, surfaces, type } from './theme';

type Icon = keyof typeof Ionicons.glyphMap;
export function HeaderAction({
  icon,
  label,
  onPress,
}: {
  icon: Icon;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [s.icon, pressed && s.pressed]}
    >
      <Ionicons name={icon} size={25} color={colors.text} />
    </Pressable>
  );
}
export function TabHeading({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <View style={s.heading}>
      <Text style={s.title} accessibilityRole="header">
        {title}
      </Text>
      {right}
    </View>
  );
}
export function SectionHeading({
  title,
  right,
  badge,
}: {
  title: string;
  right?: ReactNode;
  badge?: number;
}) {
  return (
    <View style={s.heading}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Text style={s.section} accessibilityRole="header">
          {title}
        </Text>
        {badge ? (
          <View style={s.badge}>
            <Text style={s.badgeText}>{badge}</Text>
          </View>
        ) : null}
      </View>
      {right}
    </View>
  );
}
export function ListRow({
  title,
  subtitle,
  leading,
  right,
  onPress,
  danger = false,
  disabled = false,
  muted = false,
}: {
  title: string;
  subtitle?: string;
  leading?: ReactNode;
  right?: ReactNode;
  onPress?: () => void;
  danger?: boolean;
  disabled?: boolean;
  muted?: boolean;
}) {
  const content = (
    <>
      {leading}
      <View style={s.who}>
        <Text
          style={[
            s.rowTitle,
            danger && { color: colors.primary },
            muted && { color: colors.muted, fontFamily: fonts.regular },
          ]}
        >
          {title}
        </Text>
        {subtitle ? <Text style={s.sub}>{subtitle}</Text> : null}
      </View>
      {right ??
        (onPress ? <Ionicons name="chevron-forward" size={19} color={colors.muted} /> : null)}
    </>
  );
  // Keep secondary row actions outside the main target (no nested press responders).
  if (onPress && right)
    return (
      <View style={s.row}>
        <Pressable
          onPress={onPress}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
          accessibilityState={{ disabled }}
          style={({ pressed }) => [
            {
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.md,
              minHeight: MIN_TARGET,
            },
            pressed && s.pressed,
          ]}
        >
          {leading}
          <View style={s.who}>
            <Text
              style={[
                s.rowTitle,
                danger && { color: colors.primary },
                muted && { color: colors.muted, fontFamily: fonts.regular },
              ]}
            >
              {title}
            </Text>
            {subtitle ? <Text style={s.sub}>{subtitle}</Text> : null}
          </View>
        </Pressable>
        {right}
      </View>
    );
  return onPress ? (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [s.row, pressed && s.pressed, disabled && { opacity: 0.5 }]}
    >
      {content}
    </Pressable>
  ) : (
    <View style={s.row}>{content}</View>
  );
}
export function Segments<T extends string>({
  options,
  value,
  onChange,
  label,
  variant = 'default',
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  variant?: 'default' | 'compact' | 'underline';
}) {
  return (
    <View
      style={[
        s.segments,
        variant === 'compact' && s.compactSegments,
        variant === 'underline' && s.underlineSegments,
      ]}
      accessibilityRole="tablist"
      accessibilityLabel={label}
    >
      {options.map((o) => (
        <Pressable
          key={o.value}
          onPress={() => onChange(o.value)}
          accessibilityRole="tab"
          accessibilityLabel={o.label}
          accessibilityState={{ selected: o.value === value }}
          style={[
            s.segment,
            variant === 'compact' && s.compactSegment,
            o.value === value && s.selected,
            variant === 'underline' && s.underlineSegment,
            variant === 'underline' && o.value === value && s.underlineSelected,
          ]}
        >
          <Text
            style={[
              s.segmentText,
              variant === 'compact' && s.compactSegmentText,
              variant === 'underline' && o.value === value && { color: colors.primary },
            ]}
          >
            {o.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
export function QuietEmpty({ icon, title, body }: { icon: Icon; title: string; body: string }) {
  return (
    <View style={s.empty}>
      <Ionicons name={icon} size={32} color={colors.muted} />
      <Text style={s.section}>{title}</Text>
      <Text style={[s.sub, { textAlign: 'center' }]}>{body}</Text>
    </View>
  );
}
export function Sheet({
  visible,
  title,
  onClose,
  children,
  onDismiss,
  animationType = 'slide',
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  onDismiss?: () => void;
  /** Opt-in motion preference; other sheets retain their existing transition. */
  animationType?: 'none' | 'slide' | 'fade';
}) {
  const wasVisible = useRef(visible);
  useEffect(() => {
    // Android removes the dialog when visible becomes false; no slide animation
    // is used for an opted-in handoff. RN exposes native onDismiss only on iOS.
    const dismissed = wasVisible.current && !visible;
    wasVisible.current = visible;
    if (dismissed && Platform.OS !== 'ios') onDismiss?.();
  }, [visible, onDismiss]);
  return (
    <Modal
      visible={visible}
      transparent
      animationType={onDismiss && Platform.OS !== 'ios' ? 'none' : animationType}
      onDismiss={Platform.OS === 'ios' ? onDismiss : undefined}
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={s.modal}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable
          style={s.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={`Close ${title}`}
        />
        <SafeAreaView edges={['bottom', 'left', 'right']} style={s.sheet}>
          <View style={s.sheetHead}>
            <Text style={s.section} accessibilityRole="header">
              {title}
            </Text>
            <HeaderAction icon="close" label={`Close ${title}`} onPress={onClose} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.sheetBody}>
            {children}
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}
const s = StyleSheet.create({
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xs,
  },
  badgeText: { ...type.caption, color: colors.primaryText, fontFamily: fonts.semibold },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  title: { ...type.title, color: colors.text },
  section: { ...type.heading, color: colors.text },
  icon: {
    minWidth: MIN_TARGET,
    minHeight: MIN_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    ...surfaces.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 64,
    paddingVertical: space.sm,
  },
  who: { flex: 1, gap: space.xs },
  rowTitle: { ...type.body, fontFamily: fonts.semibold, color: colors.text },
  sub: { ...type.caption, color: colors.muted, lineHeight: 20 },
  pressed: { opacity: 0.65 },
  segments: { ...surfaces.control, flexDirection: 'row', borderRadius: radius.pill, padding: 3 },
  segment: {
    flex: 1,
    minHeight: MIN_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  underlineSegments: {
    backgroundColor: colors.transparent,
    borderWidth: 0,
    borderRadius: 0,
    padding: 0,
  },
  underlineSegment: {
    borderRadius: 0,
    backgroundColor: colors.transparent,
    borderBottomWidth: 2,
    borderBottomColor: colors.transparent,
  },
  underlineSelected: { borderBottomColor: colors.primary },
  compactSegments: { borderWidth: 0, borderRadius: radius.md, padding: space.xs },
  compactSegment: {
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
  },
  compactSegmentText: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22 },
  selected: { backgroundColor: colors.cardHi },
  segmentText: { ...type.body, color: colors.text },
  empty: {
    alignItems: 'center',
    paddingVertical: space.xxl,
    gap: space.sm,
    paddingHorizontal: space.xl,
  },
  modal: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: colors.scrim },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: '88%',
    borderWidth: 1,
    borderColor: colors.border,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xl,
    paddingTop: space.md,
  },
  sheetBody: { padding: space.xl, gap: space.lg },
});
