import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { metersToMiles } from '@shared/domain/createPick.ts';

import type { MapPickerProps } from './MapPicker';
import { colors, radius, space, type } from './theme';

/** react-native-maps has no web support; on web, show where the pin is instead of a map. */
export function MapPicker({ center, radiusM, height = 240 }: MapPickerProps) {
  return (
    <View style={[styles.wrap, { height }]} accessible accessibilityLabel="Pick center">
      <View style={styles.ring}>
        <Ionicons name="location" size={34} color={colors.primary} />
      </View>
      <Text style={styles.coords}>
        {center.lat.toFixed(4)}, {center.lng.toFixed(4)}
      </Text>
      <Text style={styles.note}>
        {metersToMiles(radiusM).toFixed(1)} mi around this point · the map shows on the phone app
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    padding: space.lg,
  },
  ring: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: 'rgba(255, 79, 109, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coords: { ...type.body, color: colors.text },
  note: { ...type.caption, color: colors.muted, textAlign: 'center' },
});
