// "…" on someone else's row in the Lobby or the waiting room: report them or block them.
// Same bottom sheet as HostMenu. Blocking is silent: they aren't told, and they can no longer
// friend you, join your Picks, or be added to your groups (0014).
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAction } from '@/hooks/useAction';
import { api } from '@/lib/api';
import { confirmAction } from '@/lib/confirm';
import { haptic } from '@/lib/haptics';

import { ErrorBanner } from './ErrorBanner';
import { MenuItem, menuStyles } from './HostMenu';
import { colors } from './theme';

const REASONS = [
  { reason: 'Harassment or bullying', hint: 'They were mean or threatening' },
  { reason: 'Offensive name or picture', hint: 'Their name or photo isn’t OK' },
  { reason: 'Spam or a fake account', hint: 'They aren’t a real person or keep spamming' },
] as const;

interface Props {
  userId: string;
  name: string;
}

export function MemberMenu({ userId, name }: Props) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'menu' | 'report' | 'done'>('menu');
  const [message, setMessage] = useState('');
  const action = useAction();

  const show = () => {
    haptic.tap();
    setStep('menu');
    setOpen(true);
  };
  const finish = (text: string) => {
    haptic.success();
    setMessage(text);
    setStep('done');
  };

  const report = async (reason: string) => {
    const ok = await action.run('report', () =>
      api.report({ kind: 'user', targetId: userId, reason }),
    );
    if (ok) finish(`Thanks. We’ll look into ${name}.`);
  };

  const block = async () => {
    const sure = await confirmAction({
      title: `Block ${name}?`,
      message:
        'They won’t be told. They can’t friend you, join your Picks or be added to your groups. Picks you’re both already in stay as they are.',
      confirmLabel: 'Block',
      destructive: true,
    });
    if (sure && (await action.run('block', () => api.blockUser(userId)))) {
      finish(`${name} is blocked.`);
    }
  };

  return (
    <>
      <Pressable
        onPress={show}
        accessibilityRole="button"
        accessibilityLabel={`Options for ${name}`}
        accessibilityHint="Report or block"
        style={menuStyles.trigger}
      >
        <Ionicons name="ellipsis-horizontal" size={20} color={colors.text} />
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable
          style={menuStyles.backdrop}
          onPress={() => setOpen(false)}
          accessibilityLabel="Close options"
        />
        <SafeAreaView edges={['bottom']} style={menuStyles.sheet}>
          <View style={menuStyles.handle} />
          <Text style={menuStyles.title} accessibilityRole="header">
            {step === 'report' ? `Report ${name}` : name}
          </Text>
          {action.error ? <ErrorBanner message={action.error} onRetry={action.clearError} /> : null}
          {step === 'menu' ? (
            <>
              <MenuItem
                icon="flag"
                label="Report"
                hint="Tell us something isn’t right"
                onPress={() => setStep('report')}
              />
              <MenuItem
                icon="hand-left"
                label="Block"
                hint="They won’t be able to reach you"
                danger
                busy={action.busy === 'block'}
                onPress={() => void block()}
              />
            </>
          ) : null}
          {step === 'report'
            ? REASONS.map((r) => (
                <MenuItem
                  key={r.reason}
                  icon="chevron-forward"
                  label={r.reason}
                  hint={r.hint}
                  busy={action.busy === 'report'}
                  onPress={() => void report(r.reason)}
                />
              ))
            : null}
          {step === 'done' ? (
            <MenuItem
              icon="checkmark-circle"
              label={message}
              hint="Tap to close"
              onPress={() => setOpen(false)}
            />
          ) : null}
        </SafeAreaView>
      </Modal>
    </>
  );
}
