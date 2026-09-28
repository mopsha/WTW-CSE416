import { StyleSheet, Text, View } from 'react-native';

import { Button } from './Button';
import { colors } from './theme';

interface Props {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}

export function ErrorBanner({ message, onRetry, retryLabel = 'Retry' }: Props) {
  return (
    <View style={styles.banner} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Text style={styles.text}>{message}</Text>
      {onRetry ? (
        <Button label={retryLabel} variant="secondary" onPress={onRetry} style={styles.button} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.dangerBg,
  },
  text: { flex: 1, color: colors.danger, fontSize: 15 },
  button: { paddingHorizontal: 14 },
});
