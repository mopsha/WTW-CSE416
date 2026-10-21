// Entry point for any Pick (the Picks list, notifications, a reload): reads the live state
// and sends you to the current step. It also owns the states with no step of their own:
// canceled, not found / not a participant, and offline before anything loaded.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { GradientButton } from '@/components/GradientButton';
import { CenterMessage, FlameOrb, goToPicks, pickStyles } from '@/components/PickParts';
import { usePickLive } from '@/hooks/usePickLive';
import { pathFor, screenForState } from '@/lib/pickRoute';

export default function PickEntry() {
  const { id: pickId = '' } = useLocalSearchParams<{ id: string }>();
  const { state, progress, error, refresh } = usePickLive(pickId);
  const me = progress?.participants.find((p) => p.isMe);

  useEffect(() => {
    if (!state || state === 'canceled') return;
    const target = screenForState(state, { allAnswered: me?.done });
    router.replace({ pathname: pathFor(target), params: { id: pickId } });
  }, [state, me?.done, pickId]);

  if (state === 'canceled') {
    return (
      <SafeAreaView style={pickStyles.screen}>
        <CenterMessage
          emoji="🚫"
          title="This Pick was canceled"
          body="The host called it off. Nothing was decided, and nobody’s answers were shared."
        >
          <GradientButton label="Start a new Pick" onPress={() => router.replace('/pick/new')} />
          <Button label="Back to your Picks" variant="link" onPress={goToPicks} />
        </CenterMessage>
      </SafeAreaView>
    );
  }

  if (error && !progress) {
    const missing = /not found|participant|forbidden/i.test(error);
    return (
      <SafeAreaView style={pickStyles.screen}>
        <CenterMessage
          emoji={missing ? '🔍' : '📡'}
          title={missing ? 'We can’t find this Pick' : 'You’re offline'}
          body={
            missing
              ? 'It may have been deleted, or you haven’t joined it yet. Ask the host for the code.'
              : `${error} We’ll keep trying.`
          }
        >
          {!missing ? <GradientButton label="Try again" onPress={() => void refresh()} /> : null}
          <Button label="Back to your Picks" variant="link" onPress={goToPicks} />
        </CenterMessage>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={pickStyles.screen}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20 }}>
        <FlameOrb />
        <Text style={pickStyles.muted}>Opening your Pick…</Text>
      </View>
    </SafeAreaView>
  );
}
