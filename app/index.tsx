import { StyleSheet, Text, View } from 'react-native';

import { PICK_STATES } from '@shared/domain/pickState.ts';

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>What&apos;s the Word?</Text>
      <Text>Pick states: {PICK_STATES.join(' → ')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16 },
  title: { fontSize: 24, fontWeight: '600' },
});
