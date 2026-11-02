// wtw://i/TOKEN (a host's "Share invite link"). Outside the auth guard so the link always
// opens: signed out, it parks the token in SecureStore and goes to sign-in (the root layout
// brings you back here after); signed in, it accepts and opens the Pick.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { CenterMessage, FlameOrb, goToPicks, pickStyles } from '@/components/PickParts';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { BAD_INVITE_MESSAGE, inviteErrorMessage } from '@/lib/join';
import { setPendingInvite } from '@/lib/pendingInvite';
import { parseInviteToken } from '@shared/domain/inviteLink.ts';

export default function InviteLink() {
  const { token = '' } = useLocalSearchParams<{ token: string }>();
  const { session } = useAuth();
  const [failure, setFailure] = useState<string | null>(null);
  const started = useRef(false);
  const parsed = parseInviteToken(token);
  // A malformed link fails like any other unusable one, without asking the server.
  const error = session && !parsed ? BAD_INVITE_MESSAGE : failure;

  useEffect(() => {
    if (!session) {
      void setPendingInvite(token).then(() => router.replace('/sign-in'));
      return;
    }
    if (started.current || !parsed) return;
    started.current = true;
    api.acceptInvite(parsed).then(
      ({ kind, targetId }) => {
        haptic.success();
        if (kind === 'pick') router.replace({ pathname: '/pick/[id]', params: { id: targetId } });
        // Groups (PR #30) have no screen of their own yet: they're on the Friends tab.
        else router.replace('/friends');
      },
      (e: unknown) => {
        haptic.error();
        setFailure(inviteErrorMessage(e));
      },
    );
  }, [session, token, parsed]);

  if (error) {
    return (
      <SafeAreaView style={pickStyles.screen}>
        <CenterMessage emoji="🔗" title="Couldn’t use that invite" body={error}>
          <Button label="Back to your Picks" variant="secondary" onPress={goToPicks} />
        </CenterMessage>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={pickStyles.screen}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20 }}>
        <FlameOrb />
        <Text style={pickStyles.muted} accessibilityLiveRegion="polite">
          Opening your invite…
        </Text>
      </View>
    </SafeAreaView>
  );
}
