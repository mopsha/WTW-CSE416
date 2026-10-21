import { StyleSheet, Text, View } from 'react-native';

import { Button, type ButtonProps } from './Button';
import { colors, space, type } from './theme';

interface Props {
  /** A single emoji works well (🍽️, 👋, 🔍). */
  emoji?: string;
  title: string;
  body?: string;
  /** Optional call to action, e.g. { label: 'Create a Pick', onPress }. */
  action?: Pick<ButtonProps, 'label' | 'onPress' | 'icon' | 'variant'>;
}

/** What a screen shows when there is nothing yet (no Picks, no friends, coming soon). */
export function EmptyState({ emoji, title, body, action }: Props) {
  return (
    <View
      style={styles.wrap}
      accessible={!action}
      accessibilityLabel={[title, body].filter(Boolean).join('. ')}
    >
      {emoji ? <Text style={styles.emoji}>{emoji}</Text> : null}
      <Text style={styles.title}>{title}</Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
      {action ? <Button {...action} style={styles.action} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.xxl,
    paddingHorizontal: space.lg,
  },
  emoji: { fontSize: 48, marginBottom: space.xs },
  title: { ...type.heading, color: colors.text, textAlign: 'center' },
  body: { ...type.body, color: colors.muted, textAlign: 'center' },
  action: { marginTop: space.md, alignSelf: 'stretch' },
});
