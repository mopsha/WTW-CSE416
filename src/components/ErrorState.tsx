import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from './Button';
import { colors, radius, space, type } from './theme';

interface Props {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  /**
   * banner: a compact inline strip above content (e.g. "1 answer didn't save") ·
   * full: the whole screen failed to load
   */
  variant?: 'banner' | 'full';
}

/** Something went wrong: say what, and offer Retry when it can help. */
export function ErrorState({ message, onRetry, retryLabel = 'Retry', variant = 'banner' }: Props) {
  if (variant === 'full') {
    return (
      <View style={styles.full} accessibilityRole="alert" accessibilityLiveRegion="polite">
        <View style={styles.iconWrap}>
          <Ionicons name="cloud-offline-outline" size={30} color={colors.no} />
        </View>
        <Text style={styles.fullTitle}>Something went wrong</Text>
        <Text style={styles.fullBody}>{message}</Text>
        {onRetry ? <Button label={retryLabel} onPress={onRetry} style={styles.fullAction} /> : null}
      </View>
    );
  }
  return (
    <View style={styles.banner} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Ionicons name="alert-circle" size={20} color={colors.danger} />
      <Text style={styles.text}>{message}</Text>
      {onRetry ? <Button label={retryLabel} variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.dangerBg,
  },
  text: { ...type.caption, flex: 1, color: colors.danger, fontSize: 14 },
  full: {
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.xxl,
    paddingHorizontal: space.lg,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.dangerBg,
    marginBottom: space.xs,
  },
  fullTitle: { ...type.heading, color: colors.text, textAlign: 'center' },
  fullBody: { ...type.body, color: colors.muted, textAlign: 'center' },
  fullAction: { marginTop: space.md, alignSelf: 'stretch' },
});
