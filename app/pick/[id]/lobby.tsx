// Lobby (draft): who's in, the join code + QR + Share, the host's invite link, lobby lock and
// Start / Cancel, and Report / Block on everyone else's row.
// Everyone moves to the deck by themselves when the host starts (usePickRoute).
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { ErrorBanner } from '@/components/ErrorBanner';
import { GradientButton } from '@/components/GradientButton';
import { MemberMenu } from '@/components/MemberMenu';
import {
  goToPicks,
  LiveDot,
  ParticipantRow,
  PickTopBar,
  Pill,
  pickStyles,
} from '@/components/PickParts';
import { colors, fonts } from '@/components/theme';
import { useAction } from '@/hooks/useAction';
import { useCountdown } from '@/hooks/useCountdown';
import { usePickLive } from '@/hooks/usePickLive';
import { usePickRoute } from '@/hooks/usePickRoute';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { api } from '@/lib/api';
import { confirmAction } from '@/lib/confirm';
import { messageOf } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { pickEmoji, pickTitle, shareMessage } from '@/lib/pickUi';
import { queries, type JoinCode } from '@/lib/queries';
import type { PickDetail } from '@/lib/types';

const MIN_TO_START = 2;

export default function LobbyScreen() {
  const { id: pickId = '' } = useLocalSearchParams<{ id: string }>();
  const live = usePickLive(pickId);
  usePickRoute(pickId, 'lobby', live.state);

  const [pick, setPick] = useState<PickDetail | null>(null);
  const [code, setCode] = useState<JoinCode | null | undefined>(undefined);
  const [locked, setLocked] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Pull down: re-read who's in and the Pick (code, settings), not just wait for Realtime.
  const pull = usePullToRefresh(async () => {
    setAttempt((a) => a + 1);
    await live.refresh();
  });
  const action = useAction();
  const countdown = useCountdown(pick?.deadlineAt ?? null);

  useEffect(() => {
    let active = true;
    Promise.all([
      api.getPick(pickId),
      queries.getJoinCode(pickId),
      queries.getLobbyLocked(pickId),
    ]).then(
      ([p, c, l]) => {
        if (!active) return;
        setPick(p);
        setCode(c);
        setLocked(l);
        setLoadError(null);
      },
      (e: unknown) => active && setLoadError(messageOf(e)),
    );
    return () => {
      active = false;
    };
  }, [pickId, attempt]);

  const people = live.progress?.participants ?? [];
  const isHost = pick?.isHost ?? people.some((p) => p.isMe && p.isHost);
  const enough = people.length >= MIN_TO_START;

  const start = () =>
    void action.run('start', async () => {
      await api.startPick(pickId);
      haptic.success();
      await live.refresh();
    });

  const cancel = async () => {
    const ok = await confirmAction({
      title: 'Cancel this Pick?',
      message: 'Everyone in the lobby will see that it was canceled.',
      confirmLabel: 'Cancel Pick',
      destructive: true,
    });
    if (ok) void action.run('cancel', () => api.cancelPick(pickId).then(() => live.refresh()));
  };

  const share = () => {
    if (!code) return;
    haptic.tap();
    void Share.share({ message: shareMessage(code.code) }).catch(() => {});
  };

  // A link instead of the code: works signed out (it waits through sign-in), and the host can
  // revoke it. Made fresh each time, so one leaked link doesn't open every future Pick.
  const shareLink = () =>
    void action.run('link', async () => {
      haptic.tap();
      const link = await api.createInvite({ kind: 'pick', targetId: pickId });
      await Share.share({ message: `Join my Pick on WTW: ${link.url}` }).catch(() => {});
    });

  const toggleLock = () =>
    void action.run('lock', async () => {
      const result = await api.setLobbyLocked(pickId, !locked);
      haptic.success();
      setLocked(result.locked);
    });

  const settings = pick
    ? [
        { icon: 'locate' as const, text: `${(pick.radiusM / 1609.34).toFixed(1)} mi` },
        { icon: 'albums' as const, text: `${pick.poolSize} places` },
        {
          icon: 'timer' as const,
          text: pick.deadlineAt ? (countdown.label ?? '') : 'No deadline',
        },
        {
          icon: 'people' as const,
          text:
            pick.closeThreshold >= 100
              ? 'Closes when all done'
              : `Closes at ${pick.closeThreshold}% done`,
        },
      ]
    : [];

  return (
    <SafeAreaView style={pickStyles.screen} edges={['top', 'left', 'right', 'bottom']}>
      <PickTopBar
        title={`${pickTitle(pick?.category)} ${pickEmoji(pick?.category)}`}
        subtitle="Lobby · waiting to start"
        right={<LiveDot mode={live.mode} offline={!!live.error} />}
      />
      <ScrollView contentContainerStyle={pickStyles.scroll} refreshControl={pull}>
        {loadError ? (
          <ErrorBanner message={loadError} onRetry={() => setAttempt((a) => a + 1)} />
        ) : null}
        {live.error ? (
          <ErrorBanner message={`${live.error} Retrying…`} onRetry={() => void live.refresh()} />
        ) : null}

        <Animated.View
          entering={FadeInDown.duration(400)}
          style={[pickStyles.card, styles.codeCard]}
        >
          <Text style={pickStyles.eyebrow}>INVITE YOUR CREW</Text>
          {code ? (
            <>
              <View
                style={styles.qr}
                accessible
                accessibilityLabel={`QR code for join code ${code.code}`}
              >
                <QRCode
                  value={`wtw://join/${code.code}`}
                  size={168}
                  backgroundColor="#FFFFFF"
                  color="#0E0B12"
                />
              </View>
              <Text
                style={styles.code}
                selectable
                accessibilityLabel={`Join code ${code.code.split('').join(' ')}`}
              >
                {code.code}
              </Text>
              <Button
                label="Share invite"
                variant="secondary"
                icon="share-outline"
                onPress={share}
              />
              {isHost ? (
                <Button
                  label="Share invite link"
                  variant="secondary"
                  icon="link-outline"
                  accessibilityHint="Makes a one-tap link to this Pick that you can revoke"
                  loading={action.busy === 'link'}
                  disabled={!!action.busy || locked}
                  onPress={shareLink}
                />
              ) : null}
              {isHost ? (
                <Button
                  label={locked ? 'Unlock the lobby' : 'Lock the lobby'}
                  variant="link"
                  icon={locked ? 'lock-open-outline' : 'lock-closed-outline'}
                  accessibilityHint={
                    locked
                      ? 'Lets people join with the code or a link again'
                      : 'Stops anyone new joining with the code or a link'
                  }
                  loading={action.busy === 'lock'}
                  disabled={!!action.busy}
                  onPress={toggleLock}
                />
              ) : null}
              {locked ? (
                <Text style={pickStyles.muted}>Locked: nobody new can join right now.</Text>
              ) : null}
            </>
          ) : (
            <Text style={pickStyles.muted}>
              {code === undefined
                ? 'Getting your code…'
                : 'Join codes are on their way. Add friends from the Friends tab for now.'}
            </Text>
          )}
        </Animated.View>

        <View style={styles.pills}>
          {settings.map((s) => (
            <Pill
              key={s.icon}
              icon={s.icon}
              text={s.text}
              tone={s.icon === 'timer' && countdown.passed ? 'warn' : 'muted'}
            />
          ))}
        </View>

        <View style={pickStyles.card}>
          <View style={styles.headRow}>
            <Text style={pickStyles.section}>Who&apos;s in</Text>
            <Text style={styles.count}>{people.length}</Text>
          </View>
          {people.map((p) => (
            <Animated.View
              key={p.userId}
              entering={FadeInDown.springify()}
              layout={LinearTransition}
            >
              <ParticipantRow
                person={p}
                status={p.isHost ? null : 'Joined'}
                right={p.isMe ? null : <MemberMenu userId={p.userId} name={p.displayName} />}
              />
            </Animated.View>
          ))}
          {!enough ? (
            <View style={styles.hint}>
              <Ionicons name="hourglass-outline" size={16} color={colors.muted} />
              <Text style={styles.hintText}>Waiting for at least one friend to join…</Text>
            </View>
          ) : null}
        </View>

        {action.error ? <ErrorBanner message={action.error} onRetry={action.clearError} /> : null}

        {isHost ? (
          <View style={{ gap: 8 }}>
            <GradientButton
              label={enough ? 'Start swiping 🔥' : 'Need 2 people to start'}
              accessibilityHint="Builds the pool of places and starts swiping for everyone"
              disabled={!enough || !!action.busy}
              loading={action.busy === 'start'}
              onPress={start}
            />
            <Button
              label="Cancel Pick"
              variant="link"
              loading={action.busy === 'cancel'}
              disabled={!!action.busy}
              onPress={() => void cancel()}
            />
          </View>
        ) : (
          <View style={[pickStyles.card, styles.guest]}>
            <Text style={pickStyles.muted}>
              You&apos;re in! Swiping starts when the host taps Start. Stay here, or come back
              later: you won&apos;t miss anything.
            </Text>
            <Button label="Back to your Picks" variant="link" onPress={goToPicks} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  codeCard: { alignItems: 'center' },
  qr: { padding: 12, borderRadius: 20, backgroundColor: '#FFFFFF' },
  code: {
    fontFamily: fonts.black,
    fontSize: 36,
    letterSpacing: 8,
    color: colors.text,
  },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  count: { fontFamily: fonts.bold, fontSize: 16, color: colors.muted },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  hintText: { fontFamily: fonts.medium, fontSize: 14, color: colors.muted, flexShrink: 1 },
  guest: { alignItems: 'center' },
});
