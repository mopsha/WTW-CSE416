// Report or block someone. MemberMenu is the "…" on another person's row or profile; SafetySheet
// is the same bottom sheet (like HostMenu), also opened for a single chat message. Blocking is
// silent: they aren't told, and they can no longer friend or message you, join your Picks, or be
// added to your groups (0014).
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { ReportKind } from '@shared/api/safety.ts';

import { useAction } from '@/hooks/useAction';
import { api } from '@/lib/api';
import { confirmAction } from '@/lib/confirm';
import { haptic } from '@/lib/haptics';

import { ErrorBanner } from './ErrorBanner';
import { MenuItem, menuStyles } from './HostMenu';
import { colors } from './theme';

const USER_REASONS = [
  { reason: 'Harassment or bullying', hint: 'They were mean or threatening' },
  { reason: 'Offensive name or picture', hint: 'Their name or photo isn’t OK' },
  { reason: 'Spam or a fake account', hint: 'They aren’t a real person or keep spamming' },
] as const;

const MESSAGE_REASONS = [
  { reason: 'Harassment or bullying', hint: 'It’s mean or targets someone' },
  { reason: 'Hate speech or threats', hint: 'It attacks a group or threatens harm' },
  { reason: 'Sexual or violent content', hint: 'It isn’t OK to share here' },
  { reason: 'Spam', hint: 'It’s unwanted or repeated' },
] as const;

interface SheetProps {
  onClose(): void;
  /** The person this is about. */
  userId: string;
  name: string;
  /** What Report files; defaults to the person. */
  target?: { kind: ReportKind; id: string };
  onBlocked?(): void;
}

/** Mount it to open it, so every opening starts on a clean menu. */
export function SafetySheet({ onClose, userId, name, target, onBlocked }: SheetProps) {
  const [step, setStep] = useState<'menu' | 'report' | 'done'>('menu');
  const [message, setMessage] = useState('');
  const action = useAction();
  const reportsMessage = target?.kind === 'group_message' || target?.kind === 'direct_message';

  const finish = (text: string) => {
    haptic.success();
    setMessage(text);
    setStep('done');
  };

  const report = async (reason: string) => {
    const ok = await action.run('report', () =>
      api.report({ kind: target?.kind ?? 'user', targetId: target?.id ?? userId, reason }),
    );
    if (ok)
      finish(
        reportsMessage
          ? 'Thanks. We’ll look into this message.'
          : `Thanks. We’ll look into ${name}.`,
      );
  };

  const block = async () => {
    const sure = await confirmAction({
      title: `Block ${name}?`,
      message:
        'They won’t be told. They can’t friend or message you, join your Picks or be added to your groups. Picks you’re both already in stay as they are.',
      confirmLabel: 'Block',
      destructive: true,
    });
    if (sure && (await action.run('block', () => api.blockUser(userId)))) {
      finish(`${name} is blocked.`);
      onBlocked?.();
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={menuStyles.backdrop} onPress={onClose} accessibilityLabel="Close options" />
      <SafeAreaView edges={['bottom']} style={menuStyles.sheet}>
        <View style={menuStyles.handle} />
        <Text style={menuStyles.title} accessibilityRole="header">
          {step === 'report' ? (reportsMessage ? 'Report message' : `Report ${name}`) : name}
        </Text>
        {action.error ? <ErrorBanner message={action.error} onRetry={action.clearError} /> : null}
        {step === 'menu' ? (
          <>
            <MenuItem
              icon="flag"
              label={reportsMessage ? 'Report message' : 'Report'}
              hint="Tell us something isn’t right"
              onPress={() => setStep('report')}
            />
            <MenuItem
              icon="hand-left"
              label={reportsMessage ? `Block ${name}` : 'Block'}
              hint="They won’t be able to reach you"
              danger
              busy={action.busy === 'block'}
              onPress={() => void block()}
            />
          </>
        ) : null}
        {step === 'report'
          ? (reportsMessage ? MESSAGE_REASONS : USER_REASONS).map((r) => (
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
          <MenuItem icon="checkmark-circle" label={message} hint="Tap to close" onPress={onClose} />
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

export function MemberMenu({
  userId,
  name,
  onBlocked,
}: {
  userId: string;
  name: string;
  onBlocked?(): void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable
        onPress={() => {
          haptic.tap();
          setOpen(true);
        }}
        accessibilityRole="button"
        accessibilityLabel={`Options for ${name}`}
        accessibilityHint="Report or block"
        style={menuStyles.trigger}
      >
        <Ionicons name="ellipsis-horizontal" size={20} color={colors.text} />
      </Pressable>
      {open ? (
        <SafetySheet
          onClose={() => setOpen(false)}
          userId={userId}
          name={name}
          onBlocked={onBlocked}
        />
      ) : null}
    </>
  );
}
