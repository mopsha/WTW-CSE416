import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import type { IconName } from './AppLogo';

import { Button, type ButtonProps } from './Button';
import { colors, space, type } from './theme';

interface Props {
  /** An Ionicons outline glyph (search-outline, people-outline…), drawn decoratively in colors.muted. */
  icon?: IconName;
  title: string;
  body?: string;
  /** Optional call to action, e.g. { label: 'Create a Pick', onPress }. */
  action?: Pick<ButtonProps, 'label' | 'onPress' | 'icon' | 'variant'>;
}

/** What a screen shows when there is nothing yet (no Picks, no friends, coming soon). */
export function EmptyState({ icon, title, body, action }: Props) {
  return (
    <View
      style={styles.wrap}
      accessible={!action}
      accessibilityLabel={[title, body].filter(Boolean).join('. ')}
    >
      {icon ? (
        <Ionicons
          name={icon}
          size={44}
          color={colors.muted}
          style={styles.icon}
          accessible={false}
        />
      ) : null}
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
  icon: { marginBottom: space.xs },
  title: { ...type.heading, color: colors.text, textAlign: 'center' },
  body: { ...type.body, color: colors.muted, textAlign: 'center' },
  action: { marginTop: space.md, alignSelf: 'stretch' },
});
