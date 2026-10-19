// The host's controls while swiping: close now, refresh the places, cancel. A bottom sheet
// behind one header button, so the deck stays uncluttered.
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAction } from '@/hooks/useAction';
import { api, ApiError } from '@/lib/api';
import { confirmAction } from '@/lib/confirm';
import { haptic } from '@/lib/haptics';

import { ErrorBanner } from './ErrorBanner';
import { colors, fonts, MIN_TARGET } from './theme';

interface Props {
  pickId: string;
  /** Called after an action succeeds (e.g. re-read the Pick). */
  onChanged?: () => void;
}

export function HostMenu({ pickId, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const action = useAction();

  const done = () => {
    setOpen(false);
    onChanged?.();
  };

  const closeNow = async () => {
    const ok = await confirmAction({
      title: 'Close swiping now?',
      message: 'Anyone who hasn’t finished counts as Maybe on the places they skipped.',
      confirmLabel: 'Close now',
    });
    if (ok && (await action.run('close', () => api.closePick(pickId)))) {
      haptic.success();
      done();
    }
  };

  const refresh = async () => {
    const tryRefresh = (confirm: boolean) => api.refreshPick(pickId, confirm);
    const ok = await action.run('refresh', async () => {
      try {
        await tryRefresh(false);
      } catch (e) {
        if (!(e instanceof ApiError) || e.code !== 'CONFIRM_REQUIRED') throw e;
        const sure = await confirmAction({
          title: 'Get new places?',
          message: 'People have already swiped. A new pool clears everyone’s answers.',
          confirmLabel: 'Clear and refresh',
          destructive: true,
        });
        if (!sure) return;
        await tryRefresh(true);
      }
    });
    if (ok) done();
  };

  const cancel = async () => {
    const ok = await confirmAction({
      title: 'Cancel this Pick?',
      message: 'Swiping stops for everyone and nothing gets decided.',
      confirmLabel: 'Cancel Pick',
      destructive: true,
    });
    if (ok && (await action.run('cancel', () => api.cancelPick(pickId)))) done();
  };

  return (
    <>
      <Pressable
        onPress={() => {
          haptic.tap();
          setOpen(true);
        }}
        accessibilityRole="button"
        accessibilityLabel="Host options"
        accessibilityHint="Close swiping, refresh the places, or cancel"
        style={styles.trigger}
      >
        <Ionicons name="options" size={20} color={colors.text} />
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable
          style={styles.backdrop}
          onPress={() => setOpen(false)}
          accessibilityLabel="Close host options"
        />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title} accessibilityRole="header">
            Host options
          </Text>
          {action.error ? <ErrorBanner message={action.error} onRetry={action.clearError} /> : null}
          <Item
            icon="flag"
            label="Close swiping now"
            hint="Rank what we have and pick a winner"
            busy={action.busy === 'close'}
            onPress={() => void closeNow()}
          />
          <Item
            icon="refresh"
            label="Get new places"
            hint="Rebuilds the pool; clears answers if anyone has swiped"
            busy={action.busy === 'refresh'}
            onPress={() => void refresh()}
          />
          <Item
            icon="close-circle"
            label="Cancel Pick"
            hint="Stops it for everyone"
            danger
            busy={action.busy === 'cancel'}
            onPress={() => void cancel()}
          />
        </SafeAreaView>
      </Modal>
    </>
  );
}

function Item({
  icon,
  label,
  hint,
  danger,
  busy,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  hint: string;
  danger?: boolean;
  busy?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ busy: !!busy }}
      style={({ pressed }) => [styles.item, pressed && { opacity: 0.7 }]}
    >
      <View style={[styles.itemIcon, danger && { backgroundColor: colors.dangerBg }]}>
        <Ionicons name={icon} size={20} color={danger ? colors.danger : colors.text} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.itemLabel, danger && { color: colors.danger }]}>
          {busy ? 'Working…' : label}
        </Text>
        <Text style={styles.itemHint}>{hint}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  trigger: {
    width: MIN_TARGET,
    height: MIN_TARGET,
    borderRadius: MIN_TARGET / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
  },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    paddingTop: 10,
    gap: 6,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.border,
    marginBottom: 8,
  },
  title: { fontFamily: fonts.black, fontSize: 22, color: colors.text, marginBottom: 4 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 64, paddingVertical: 6 },
  itemIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.cardHi,
  },
  itemLabel: { fontFamily: fonts.bold, fontSize: 16, color: colors.text },
  itemHint: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted },
});
