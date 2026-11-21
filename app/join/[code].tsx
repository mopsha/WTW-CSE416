// wtw://join/CODE (the Lobby's QR code and share link). Outside the auth guard so the link
// always opens: signed out, it parks the code and goes to sign-in (the root layout brings you
// back here after); signed in, it asks first, then joins and opens the Pick, which forwards to
// the Lobby. Asking first means a link or QR code someone else made can't join you silently.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { GradientButton } from '@/components/GradientButton';
import { CenterMessage, FlameOrb, goToPicks, pickStyles } from '@/components/PickParts';
import { useAuth } from '@/hooks/useAuth';
import { useJoinPick } from '@/hooks/useJoinPick';
import { setPendingJoin } from '@/lib/pendingJoin';

export default function JoinByLink() {
  const { code = '' } = useLocalSearchParams<{ code: string }>();
  const { session } = useAuth();
  const { error, join } = useJoinPick();
  const [confirmed, setConfirmed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (!session) {
      setPendingJoin(code);
      router.replace('/sign-in');
      return;
    }
    if (!confirmed || started.current) return;
    started.current = true;
    void join(code).then((pickId) => {
      if (pickId) router.replace({ pathname: '/pick/[id]', params: { id: pickId } });
    });
  }, [session, code, join, confirmed]);

  if (error) {
    return (
      <SafeAreaView style={pickStyles.screen}>
        <CenterMessage icon="search-outline" title="Couldn’t join that Pick" body={error}>
          <Button
            label="Back to your Picks"
            variant="secondary"
            accessibilityHint="You can type a code there instead"
            onPress={goToPicks}
          />
        </CenterMessage>
      </SafeAreaView>
    );
  }

  if (session && !confirmed) {
    return (
      <SafeAreaView style={pickStyles.screen}>
        <CenterMessage
          logo
          title="Join this Pick?"
          body="Someone shared a Pick with you. Join only if you know who sent it."
        >
          <GradientButton label="Join the Pick" onPress={() => setConfirmed(true)} />
          <Button label="Not now" variant="link" onPress={goToPicks} />
        </CenterMessage>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={pickStyles.screen}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20 }}>
        <FlameOrb />
        <Text style={pickStyles.muted} accessibilityLiveRegion="polite">
          Joining the Pick…
        </Text>
      </View>
    </SafeAreaView>
  );
}
