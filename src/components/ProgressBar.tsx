import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';

import { colors, flame, fonts } from './theme';

interface Props {
  /** How many are done. */
  value: number;
  /** Out of how many. */
  total: number;
  /** Show "7/20" next to the bar (default true). */
  showCount?: boolean;
  /** What is being counted, for screen readers (e.g. "cards answered"). */
  accessibilityLabel?: string;
}

/** Gradient progress bar with an optional "7/20" count. */
export function ProgressBar({ value, total, showCount = true, accessibilityLabel }: Props) {
  const safeTotal = Math.max(0, total);
  const done = Math.min(Math.max(0, value), safeTotal);
  const pct = safeTotal === 0 ? 0 : (done / safeTotal) * 100;
  return (
    <View
      style={styles.row}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel ?? 'Progress'}
      accessibilityValue={{ min: 0, max: safeTotal, now: done, text: `${done} of ${safeTotal}` }}
    >
      <View style={styles.track}>
        <LinearGradient
          colors={flame}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[styles.fill, { width: `${pct}%` }]}
        />
      </View>
      {showCount ? (
        <Text style={styles.count}>
          {done}/{safeTotal}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  track: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.card, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3 },
  count: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.text,
    minWidth: 44,
    textAlign: 'right',
  },
});
