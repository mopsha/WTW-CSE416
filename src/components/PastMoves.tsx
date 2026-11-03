import type { PastMove, PastMovesResult } from '@shared/api/pastMoves.ts';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Button, Card, colors, ErrorState, space, type } from '@/components';
import { api } from '@/lib/api';
import { messageOf } from '@/lib/errors';

export function PastMoveCard({ move }: { move: PastMove }) {
  const date = new Date(move.occurredAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  return (
    <Card
      onPress={() => router.push(`/pick/${move.pickId}`)}
      accessibilityLabel={`${move.winner.name ?? 'Saved place'}, ${date}, Past Move`}
    >
      <Text style={s.caption}>{date} · Past Move</Text>
      <Text style={s.heading}>{move.winner.name ?? 'Saved place'}</Text>
      {move.winner.origin === 'group_idea' ? <Text style={s.caption}>Group Idea</Text> : null}
      {move.winner.locationText ? <Text style={s.caption}>{move.winner.locationText}</Text> : null}
      {move.group ? <Text style={s.caption}>{move.group.name}</Text> : null}
      {move.participantCount !== null ? (
        <Text style={s.caption}>
          {move.attendedCount} confirmed · {move.participantCount} participants
        </Text>
      ) : null}
    </Card>
  );
}
export function PastMoves({ userId }: { userId: string }) {
  const [data, setData] = useState<PastMovesResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const latest = useRef(0);
  const load = useCallback(async () => {
    const request = ++latest.current;
    setData(null);
    setError(null);
    try {
      const value = await api.getUserPastMoves(userId);
      if (request === latest.current) setData(value);
    } catch (e) {
      if (request === latest.current) setError(messageOf(e));
    }
  }, [userId]);
  useFocusEffect(
    useCallback(() => {
      void load();
      return () => {
        latest.current++;
        setData(null);
        setError(null);
      };
    }, [load]),
  );
  return (
    <View style={{ gap: space.md }}>
      <Text style={s.heading} accessibilityRole="header">
        Past Moves
      </Text>
      {error ? (
        <ErrorState variant="banner" message={error} onRetry={() => void load()} />
      ) : !data ? (
        <ActivityIndicator color={colors.primary} accessibilityLabel="Loading Past Moves" />
      ) : !data.visible ? (
        <Text style={s.caption}>Past Moves are private.</Text>
      ) : !data.pastMoves.length ? (
        <Text style={s.caption}>
          No Past Moves to show yet. Attendance is confirmed with “Did you go?” on a past Pick.
        </Text>
      ) : (
        <>
          {data.pastMoves.slice(0, expanded ? 50 : 5).map((move) => (
            <PastMoveCard key={move.pickId} move={move} />
          ))}
          {data.pastMoves.length > 5 ? (
            <Button
              label={expanded ? 'Show fewer' : 'Show more Past Moves'}
              variant="secondary"
              onPress={() => setExpanded((v) => !v)}
            />
          ) : null}
        </>
      )}
    </View>
  );
}
const s = StyleSheet.create({
  heading: { ...type.heading, color: colors.text },
  caption: { ...type.caption, color: colors.muted },
});
