import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { haptic } from '@/lib/haptics';
import { PREFERENCE_LABEL, type PreferenceValue } from '@/lib/types';

import { colors } from './theme';

const BUTTONS: {
  value: PreferenceValue;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  size: number;
}[] = [
  { value: 0, icon: 'close', color: colors.no, size: 68 },
  { value: 1, icon: 'star', color: colors.maybe, size: 54 },
  { value: 2, icon: 'heart', color: colors.yes, size: 68 },
];

interface Props {
  placeName: string;
  /** The answer already recorded for this card, if revisiting it. */
  selected?: PreferenceValue;
  onAnswer: (value: PreferenceValue) => void;
  onBack?: () => void;
}

/** Tinder-style round No / Maybe / Yes buttons (with a small undo on the left). */
export function ActionBar({ placeName, selected, onAnswer, onBack }: Props) {
  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => {
          haptic.tap();
          onBack?.();
        }}
        disabled={!onBack}
        accessibilityRole="button"
        accessibilityLabel="Back to the previous card"
        style={({ pressed }) => [styles.small, !onBack && styles.dim, pressed && styles.pressed]}
      >
        <Ionicons name="arrow-undo" size={20} color="#FFD23F" />
      </Pressable>
      {BUTTONS.map((b) => {
        const isSelected = selected === b.value;
        return (
          <Pressable
            key={b.value}
            onPress={() => onAnswer(b.value)}
            accessibilityRole="button"
            accessibilityLabel={`${PREFERENCE_LABEL[b.value]} to ${placeName}`}
            accessibilityState={{ selected: isSelected }}
            style={({ pressed }) => [
              styles.button,
              { width: b.size, height: b.size, borderRadius: b.size / 2 },
              isSelected && { backgroundColor: b.color },
              pressed && styles.pressed,
            ]}
          >
            <Ionicons name={b.icon} size={b.size * 0.46} color={isSelected ? colors.bg : b.color} />
          </Pressable>
        );
      })}
      <View style={styles.spacer} accessible={false} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16 },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  small: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  spacer: { width: 44, height: 44 },
  dim: { opacity: 0.35 },
  pressed: { transform: [{ scale: 0.9 }] },
});
