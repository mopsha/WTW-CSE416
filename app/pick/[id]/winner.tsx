import { PickResultSkeleton } from '@/components/LoadingStates';
// Winner (completed): the place, how it was decided, Directions in the phone's maps app, and
// "Saved to your history" (the decided Pick stays in the Picks list after reopening the app).
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { Screen } from '@/components/Screen';

import { Button } from '@/components/Button';
import { CenterMessage, goToPicks } from '@/components/PickParts';
import { PlanBlock } from '@/components/PlanBlock';
import { SmallResult, WinnerCard } from '@/components/ResultCards';
import { colors, space, type } from '@/components/theme';
import { useSession } from '@/hooks/useAuth';
import { usePickLive } from '@/hooks/usePickLive';
import { usePickRoute } from '@/hooks/usePickRoute';
import { useReveal } from '@/hooks/useReveal';
import { haptic } from '@/lib/haptics';
import { directionsUrl } from '@/lib/pickUi';
import type { Candidate, DecidedBy } from '@/lib/types';

const HOW: Record<DecidedBy, string> = {
  clear_winner: 'The group’s top choice, with no final vote needed.',
  vote: 'The final vote settled it.',
  tie_break: 'The vote was tied, so the higher-ranked place won.',
};

function openDirections(place: Candidate) {
  if (place.provider === 'custom' && !place.locationProvided) return;
  haptic.tap();
  void Linking.openURL(directionsUrl(place, Platform.OS)).catch(() => {});
}

export default function WinnerScreen() {
  const { id: pickId = '' } = useLocalSearchParams<{ id: string }>();
  const session = useSession();
  return (
    <WinnerContent key={`${session.user.id}:${pickId}`} pickId={pickId} userId={session.user.id} />
  );
}
function WinnerContent({ pickId, userId }: { pickId: string; userId: string }) {
  const live = usePickLive(pickId);
  usePickRoute(pickId, 'winner', live.state);
  const { reveal, retry } = useReveal(pickId, userId, live.state);

  if (reveal.status === 'error') {
    return (
      <Screen back scroll={false}>
        <CenterMessage emoji="📡" title="Couldn’t load the winner" body={reveal.message}>
          <Button label="Try again" onPress={retry} />
          <Button label="Back to your Picks" variant="link" onPress={goToPicks} />
        </CenterMessage>
      </Screen>
    );
  }
  if (reveal.status === 'loading') {
    return (
      <Screen back>
        <PickResultSkeleton />
      </Screen>
    );
  }

  const { pick, places, ranking } = reveal;
  const winner = pick.winnerPlaceId ? places.get(pick.winnerPlaceId) : undefined;
  if (!winner) {
    return (
      <Screen back scroll={false}>
        <CenterMessage emoji="🤔" title="No winner yet" body="Give it a moment.">
          <Button label="Check again" onPress={retry} />
          <Button label="Back to your Picks" variant="link" onPress={goToPicks} />
        </CenterMessage>
      </Screen>
    );
  }

  const how = HOW[pick.decidedBy ?? 'vote'];
  const runnersUp = ranking.filter((r) => r.placeId !== winner.placeId);
  const people = live.progress?.participants ?? [];

  return (
    <Screen back>
      <View style={styles.head}>
        <Text style={styles.heading} accessibilityRole="header">
          It’s a plan!
        </Text>
        <Text style={styles.muted}>{how}</Text>
      </View>
      <WinnerCard place={winner} badge="The group’s pick" />
      {winner.provider !== 'custom' || winner.locationProvided ? (
        <Button
          label="Get directions"
          icon="navigate-outline"
          onPress={() => openDirections(winner)}
        />
      ) : null}
      <View style={styles.saved} accessible accessibilityLabel="Saved to your history">
        <Ionicons name="checkmark-circle" size={16} color={colors.yes} />
        <Text style={styles.savedText}>Saved to your history</Text>
      </View>
      <PlanBlock pickId={pickId} decidedAt={pick.decidedAt} people={people}>
        {runnersUp.length ? (
          <View style={{ gap: space.sm }}>
            <Text style={styles.heading} accessibilityRole="header">
              Other favorites
            </Text>
            {runnersUp.map((r) => {
              const p = places.get(r.placeId);
              return p ? (
                <SmallResult
                  key={r.placeId}
                  place={p}
                  rank={r.rank}
                  onPress={
                    p.provider !== 'custom' || p.locationProvided
                      ? () => openDirections(p)
                      : undefined
                  }
                />
              ) : null;
            })}
          </View>
        ) : null}
      </PlanBlock>
      <Button label="Back to your Picks" variant="link" onPress={goToPicks} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { gap: space.xs },
  heading: { ...type.heading, color: colors.text },
  muted: { ...type.caption, color: colors.muted },
  saved: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    minHeight: 32,
  },
  savedText: { ...type.caption, color: colors.muted },
});
