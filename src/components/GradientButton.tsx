import type { ViewStyle } from 'react-native';
import { Button } from './Button';

interface Props {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  accessibilityHint?: string;
  style?: ViewStyle;
}
/** Compatibility name for existing callers; primary CTAs now use solid WTW coral. */
export function GradientButton(props: Props) {
  return <Button {...props} />;
}
