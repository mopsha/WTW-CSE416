import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { colors, MIN_TARGET, space, type } from './theme';

interface Props {
  children: ReactNode;
  /** Large title at the top of the screen. */
  title?: string;
  /** Small line above the title (e.g. "Hey Mike 👋"). */
  subtitle?: string;
  /** Shows a back chevron that calls router.back(). */
  back?: boolean;
  /** Something on the right of the header row (e.g. an icon button). */
  right?: ReactNode;
  /** Wrap content in a ScrollView (default true). Use false for full-height layouts. */
  scroll?: boolean;
  /** Pull-to-refresh (only with scroll). */
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Safe-area edges; tabs screens omit 'bottom' because the tab bar handles it. */
  edges?: Edge[];
  contentStyle?: StyleProp<ViewStyle>;
}

/** Every screen's frame: safe area, dark background, optional header, padding. */
export function Screen({
  children,
  title,
  subtitle,
  back,
  right,
  scroll = true,
  onRefresh,
  refreshing = false,
  edges = ['top', 'left', 'right', 'bottom'],
  contentStyle,
}: Props) {
  const header =
    back || right || title || subtitle ? (
      <View style={styles.header}>
        {back || right ? (
          <View style={styles.headerRow}>
            {back ? (
              <Pressable
                onPress={() => router.back()}
                accessibilityRole="button"
                accessibilityLabel="Back"
                style={styles.iconButton}
              >
                <Ionicons name="chevron-back" size={24} color={colors.text} />
              </Pressable>
            ) : (
              <View />
            )}
            {right ?? null}
          </View>
        ) : null}
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        {title ? (
          <Text style={styles.title} accessibilityRole="header">
            {title}
          </Text>
        ) : null}
      </View>
    ) : null;

  return (
    <SafeAreaView style={styles.safe} edges={edges}>
      {/* Keeps focused inputs (e.g. Create Pick's place search) above the keyboard on iOS;
          Android resizes the window by itself. */}
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {scroll ? (
          <ScrollView
            contentContainerStyle={[styles.content, contentStyle]}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              onRefresh ? (
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={onRefresh}
                  tintColor={colors.primary}
                />
              ) : undefined
            }
          >
            {header}
            {children}
          </ScrollView>
        ) : (
          <View style={[styles.content, styles.fill, contentStyle]}>
            {header}
            {children}
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** A round 44-pt icon button for headers. */
export function IconButton({
  icon,
  onPress,
  accessibilityLabel,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [styles.iconButton, pressed && { opacity: 0.7 }]}
    >
      <Ionicons name={icon} size={22} color={colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.xl - 4, gap: space.lg, paddingBottom: space.xxl },
  fill: { flex: 1 },
  header: { gap: space.xs },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: space.sm,
  },
  subtitle: { ...type.body, color: colors.muted },
  title: { ...type.title, color: colors.text },
  iconButton: {
    width: MIN_TARGET,
    height: MIN_TARGET,
    borderRadius: MIN_TARGET / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
  },
});
