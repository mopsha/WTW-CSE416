import { useAvatarPhoto, usePhotoCapabilities } from '@/hooks/useAvatarSource';
// Report or block someone. MemberMenu is the "…" on another person's row or profile; SafetySheet
// is the same bottom sheet (like HostMenu), also opened for a single chat message. Blocking is
// silent: they aren't told, and they can no longer friend or message you, join your Picks, or be
// added to your groups (0014).
import { Ionicons } from '@expo/vector-icons';
import { useRef, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { AvatarRef } from '@shared/api/avatars.ts';
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
  {
    reason: 'Offensive name',
    hint: 'Their name is offensive',
  },
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
  photo?: AvatarRef;
}

/** Mount it to open it, so every opening starts on a clean menu. */
export function SafetySheet({ onClose, userId, name, target, onBlocked, photo }: SheetProps) {
  const displayed = useAvatarPhoto(photo, userId);
  const capabilities = usePhotoCapabilities();
  const reportablePhoto =
    capabilities.reportsEnabled && displayed.displayed && displayed.ref?.userId === userId
      ? displayed.ref
      : null;
  const [step, setStep] = useState<'menu' | 'report' | 'done'>('menu');
  const [message, setMessage] = useState('');
  const [photoReport, setPhotoReport] = useState<AvatarRef | null>(null);
  const action = useAction();
  const reporting = useRef(false);
  const selectedPhotoAvailable =
    !photoReport ||
    (photoReport.userId === userId &&
      displayed.displayed &&
      displayed.ref?.userId === photoReport.userId &&
      displayed.ref?.revision === photoReport.revision);
  const canSubmitPhoto = capabilities.reportsEnabled && selectedPhotoAvailable;
  const reportsMessage = target?.kind === 'group_message' || target?.kind === 'direct_message';

  const finish = (text: string) => {
    haptic.success();
    setMessage(text);
    setStep('done');
  };

  const report = async (reason: string) => {
    if (reporting.current) return;
    reporting.current = true;
    try {
      if (photoReport && !canSubmitPhoto) {
        await action.run('report', async () => {
          throw new Error(
            'Photo reporting or the selected photo is currently unavailable. No report was submitted.',
          );
        });
        return;
      }
      const ok = await action.run('report', () =>
        api.report(
          photoReport
            ? {
                kind: 'profile_photo',
                targetId: photoReport.userId,
                photoRevision: photoReport.revision,
                reason,
              }
            : { kind: target?.kind ?? 'user', targetId: target?.id ?? userId, reason },
        ),
      );
      if (!ok && photoReport) void capabilities.refresh();
      if (ok)
        finish(
          photoReport
            ? 'Thanks. We’ll look into this photo.'
            : reportsMessage
              ? 'Thanks. We’ll look into this message.'
              : `Thanks. We’ll look into ${name}.`,
        );
    } finally {
      reporting.current = false;
    }
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
          {step === 'report'
            ? photoReport
              ? 'Report profile picture'
              : reportsMessage
                ? 'Report message'
                : `Report ${name}`
            : name}
        </Text>
        {action.error ? <ErrorBanner message={action.error} onRetry={action.clearError} /> : null}
        {step === 'menu' ? (
          <>
            <MenuItem
              icon="flag"
              label={
                reportsMessage
                  ? 'Report message'
                  : target && target.kind !== 'user'
                    ? 'Report'
                    : 'Report user'
              }
              hint={
                reportsMessage
                  ? 'Tell us something isn’t right'
                  : 'Report a name, behavior, or other concern'
              }
              onPress={() => setStep('report')}
            />
            {reportablePhoto ? (
              <MenuItem
                icon="flag"
                label="Report profile picture"
                hint="Report the photo currently shown"
                onPress={() => {
                  setPhotoReport(reportablePhoto);
                  setStep('report');
                }}
              />
            ) : null}
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
        {step === 'report' && photoReport && !canSubmitPhoto && !action.error ? (
          <ErrorBanner message="Photo reporting or the selected photo is currently unavailable. No report was submitted." />
        ) : null}
        {step === 'report' && (!photoReport || canSubmitPhoto)
          ? (reportsMessage || photoReport ? MESSAGE_REASONS : USER_REASONS).map((r) => (
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
  photo,
}: {
  userId: string;
  name: string;
  onBlocked?(): void;
  photo?: AvatarRef;
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
          photo={photo}
        />
      ) : null}
    </>
  );
}
