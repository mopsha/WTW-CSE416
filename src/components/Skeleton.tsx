import type { ReactNode } from 'react';
import {
  StyleSheet,
  useWindowDimensions,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors, radius, space, type } from './theme';

/** Static decorative geometry. Only SkeletonRegion participates in accessibility. */
export function Skeleton({
  variant = 'rect',
  width = '100%',
  height,
  size = 40,
  style,
}: {
  variant?: 'rect' | 'circle' | 'line';
  width?: DimensionValue;
  height?: number;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { fontScale } = useWindowDimensions();
  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.shape,
        {
          width: variant === 'circle' ? size : width,
          height:
            variant === 'circle'
              ? size
              : variant === 'line'
                ? (height ?? type.body.lineHeight) * fontScale
                : (height ?? 80),
          borderRadius: variant === 'circle' ? size / 2 : radius.sm,
        },
        style,
      ]}
    />
  );
}

export function SkeletonRegion({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
      accessibilityLiveRegion="polite"
      pointerEvents="none"
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.stack}
      >
        {children}
      </View>
    </View>
  );
}
export function SkeletonCard({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}
export function SkeletonRow({
  avatarSize = 60,
  trailing = true,
  compact = false,
}: {
  avatarSize?: number;
  trailing?: boolean;
  compact?: boolean;
}) {
  return (
    <View style={[styles.row, compact && { minHeight: 64, paddingVertical: space.md }]}>
      <Skeleton variant="circle" size={avatarSize} />
      <View style={styles.labels}>
        <Skeleton variant="line" width="72%" height={compact ? 22 : 26} />
        <Skeleton variant="line" width="52%" height={compact ? 18 : 20} />
      </View>
      {trailing ? <Skeleton width={44} height={44} /> : null}
    </View>
  );
}
const styles = StyleSheet.create({
  shape: { backgroundColor: colors.cardHi },
  stack: { gap: space.md },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    gap: space.sm,
    overflow: 'hidden',
  },
  row: {
    minHeight: 100,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.lg,
    paddingVertical: space.lg + space.xs,
  },
  labels: { flex: 1, minWidth: 60, gap: space.xs },
});
