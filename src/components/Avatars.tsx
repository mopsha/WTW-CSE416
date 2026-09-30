import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { colors, FRIENDS, fonts } from './theme';

interface Props {
  /** Names of friends who have finished swiping (they get a check badge). */
  done?: ReadonlySet<string>;
  size?: number;
  showYou?: boolean;
}

/** Overlapping circles: Ava, Ben, Cam (+ you). */
export function AvatarStack({ done, size = 36, showYou = true }: Props) {
  const people = [
    ...FRIENDS.map((f) => ({ ...f })),
    ...(showYou ? [{ name: 'You', color: '#FF3D71' }] : []),
  ];
  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={`${people.map((p) => p.name).join(', ')}`}
    >
      {people.map((p, i) => (
        <View
          key={p.name}
          style={[
            styles.circle,
            { width: size, height: size, borderRadius: size / 2, backgroundColor: p.color },
            i > 0 && { marginLeft: -size * 0.3 },
          ]}
        >
          <Text style={[styles.initial, { fontSize: size * 0.42 }]}>{p.name[0]}</Text>
          {done?.has(p.name) ? (
            <View style={[styles.badge, { right: -2, bottom: -2 }]}>
              <Ionicons name="checkmark" size={size * 0.3} color="#0E0B12" />
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.bg,
  },
  initial: { fontFamily: fonts.bold, color: '#FFFFFF' },
  badge: {
    position: 'absolute',
    backgroundColor: colors.yes,
    borderRadius: 999,
    padding: 1,
    borderWidth: 1.5,
    borderColor: colors.bg,
  },
});
