import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from './Button';
import { colors, radius, space, type } from './theme';

/** One in-layout action banner; static presentation respects reduced motion and avoids overlays. */
export function UndoFeedback({ onUndo, pending }: { onUndo: () => void; pending: boolean }) {
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <SafeAreaView edges={['bottom', 'left', 'right']}>
        <View style={styles.banner}>
          <Text style={styles.text} accessibilityLiveRegion="polite">
            {pending ? 'Removing saved place…' : 'Saved place removed.'}
          </Text>
          <Button
            label="Undo"
            accessibilityLabel="Undo removing saved place"
            variant="link"
            onPress={onUndo}
          />
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}
const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.card,
  },
  text: { ...type.caption, color: colors.text, flex: 1 },
});
