import { router } from 'expo-router';
// The host's controls while swiping: close now, refresh the places, cancel. A bottom sheet
// behind one header button, so the deck stays uncluttered.
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Sheet } from './TabUi';

import { useAction } from '@/hooks/useAction';
import { api, ApiError } from '@/lib/api';
import { confirmAction } from '@/lib/confirm';
import { haptic } from '@/lib/haptics';

import { ErrorBanner } from './ErrorBanner';
import { colors, fonts, MIN_TARGET } from './theme';

interface Props {
  allowRefresh?: boolean;
  pickId: string;
  /** Called after an action succeeds (e.g. re-read the Pick). */
  onChanged?: () => void;
}

export function HostMenu({ pickId, onChanged, allowRefresh = true }: Props) {
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
        accessibilityHint={
          allowRefresh
            ? 'Close swiping, refresh the places, or cancel'
            : 'Invite friends, view participation, close swiping, or cancel'
        }
        style={({ pressed }) => [menuStyles.trigger, pressed && { opacity: 0.7 }]}
      >
        <Ionicons name="options" size={20} color={colors.text} />
      </Pressable>
      <Sheet
        visible={open}
        closeAccessibilityLabel="Close host options"
        dismissDisabled={!!action.busy}
        title="Host options"
        onClose={() => {
          if (!action.busy) setOpen(false);
        }}
      >
        {action.error ? <ErrorBanner message={action.error} onRetry={action.clearError} /> : null}
        <MenuItem
          icon="flag"
          label="Close swiping now"
          hint="Rank what we have and pick a winner"
          busy={action.busy === 'close'}
          onPress={() => void closeNow()}
        />
        {!allowRefresh ? (
          <MenuItem
            icon="people"
            label="Invite friends and view participation"
            hint="Share this active Pick or see availability"
            onPress={() => {
              setOpen(false);
              router.push({ pathname: '/pick/[id]/lobby', params: { id: pickId } });
            }}
          />
        ) : null}
        {allowRefresh ? (
          <MenuItem
            icon="refresh"
            label="Get new places"
            hint="Rebuilds the pool; clears answers if anyone has swiped"
            busy={action.busy === 'refresh'}
            onPress={() => void refresh()}
          />
        ) : null}
        <MenuItem
          icon="close-circle"
          label="Cancel Pick"
          hint="Stops it for everyone"
          danger
          busy={action.busy === 'cancel'}
          onPress={() => void cancel()}
        />
      </Sheet>
    </>
  );
}

/** One row of a bottom-sheet menu (HostMenu, MemberMenu). */
export function MenuItem({
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
      accessibilityState={{ busy: !!busy, disabled: !!busy }}
      style={({ pressed }) => [menuStyles.item, pressed && { opacity: 0.7 }]}
    >
      <View style={[menuStyles.itemIcon, danger && { backgroundColor: colors.dangerBg }]}>
        <Ionicons name={icon} size={20} color={danger ? colors.danger : colors.text} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[menuStyles.itemLabel, danger && { color: colors.danger }]}>
          {busy ? 'Working…' : label}
        </Text>
        <Text style={menuStyles.itemHint}>{hint}</Text>
      </View>
    </Pressable>
  );
}

/** Shared by the bottom-sheet menus. */
export const menuStyles = StyleSheet.create({
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
