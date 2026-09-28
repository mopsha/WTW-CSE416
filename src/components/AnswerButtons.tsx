import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PREFERENCE_LABEL, type PreferenceValue } from '@/lib/types';

import { colors, MIN_TARGET } from './theme';

const ORDER: readonly PreferenceValue[] = [0, 1, 2];
const COLOR: Record<PreferenceValue, string> = { 0: colors.no, 1: colors.maybe, 2: colors.yes };

interface Props {
  placeName: string;
  /** The answer already recorded for this card, if revisiting it. */
  selected?: PreferenceValue;
  onAnswer: (value: PreferenceValue) => void;
}

export function AnswerButtons({ placeName, selected, onAnswer }: Props) {
  return (
    <View style={styles.row}>
      {ORDER.map((v) => {
        const isSelected = selected === v;
        return (
          <Pressable
            key={v}
            onPress={() => onAnswer(v)}
            accessibilityRole="button"
            accessibilityLabel={`${PREFERENCE_LABEL[v]} to ${placeName}`}
            accessibilityState={{ selected: isSelected }}
            style={({ pressed }) => [
              styles.button,
              { borderColor: COLOR[v] },
              isSelected && { backgroundColor: COLOR[v] },
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.label, { color: isSelected ? '#FFFFFF' : COLOR[v] }]}>
              {PREFERENCE_LABEL[v]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10 },
  button: {
    flex: 1,
    minHeight: MIN_TARGET + 8,
    borderRadius: 14,
    borderWidth: 2,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
  label: { fontSize: 18, fontWeight: '700' },
});
