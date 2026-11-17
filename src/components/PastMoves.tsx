import { Ionicons } from '@expo/vector-icons';
import { HistorySkeleton } from './LoadingStates';
import { fonts, profileTheme } from './theme';
import { usePrivateRefresh } from '@/hooks/usePrivateRefresh';
import type { PastMove, PastMovesResult } from '@shared/api/pastMoves.ts';
import { router } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Card, colors, ErrorState, space, type, radius } from '@/components';
import { api } from '@/lib/api';
import { messageOf } from '@/lib/errors';

export function PastMoveCard({
  move,
  variant = 'default',
}: {
  move: PastMove;
  variant?: 'default' | 'profile';
}) {
  const date = new Date(move.occurredAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  return (
    <Card
      style={variant === 'profile' ? s.memory : undefined}
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
export function PastMoves({
  userId,
  variant = 'default',
}: {
  userId: string;
  variant?: 'default' | 'profile';
}) {
  const [data, setData] = useState<PastMovesResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const latest = useRef(0);
  const load = useCallback(async () => {
    const request = ++latest.current;
    setError(null);
    try {
      const value = await api.getUserPastMoves(userId);
      if (request === latest.current) setData(value);
    } catch (e) {
      if (request === latest.current) {
        setData(null);
        setError(messageOf(e));
      }
    }
  }, [userId]);
  const clear = useCallback(() => {
    latest.current++;
    setData(null);
    setError(null);
  }, []);
  usePrivateRefresh(load, clear);
  return (
    <View style={[{ gap: space.md }, variant === 'profile' && s.section]}>
      <Text style={s.heading} accessibilityRole="header">
        Past Moves
      </Text>
      {error ? (
        <ErrorState variant="banner" message={error} onRetry={() => void load()} />
      ) : !data ? (
        <HistorySkeleton label="Loading Past Moves" card />
      ) : !data.visible ? (
        <Text style={s.caption}>Past Moves are private.</Text>
      ) : !data.pastMoves.length ? (
        variant === 'profile' ? (
          <View style={s.empty}>
            <View style={s.emptyHeading}>
              <Ionicons name="sparkles-outline" size={18} color={colors.muted} accessible={false} />
              <Text style={s.emptyTitle}>Your memories start here.</Text>
            </View>
            <Text style={s.emptyBody}>
              Confirmed outings appear here. Answer “Did you go?” on a past Pick.
            </Text>
          </View>
        ) : (
          <Text style={s.caption}>
            No Past Moves to show yet. Attendance is confirmed with “Did you go?” on a past Pick.
          </Text>
        )
      ) : (
        <>
          {data.pastMoves.slice(0, expanded ? 50 : 5).map((move) => (
            <PastMoveCard key={move.pickId} move={move} variant={variant} />
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
  empty: {
    backgroundColor: profileTheme.surface,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    gap: space.xs,
  },
  emptyHeading: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  emptyTitle: { ...type.body, fontFamily: fonts.semibold, color: colors.text, flex: 1 },
  emptyBody: { ...type.caption, fontSize: 14, lineHeight: 21, color: colors.muted },
  section: { paddingTop: space.xs },
  memory: {
    backgroundColor: profileTheme.memory,
    borderWidth: 0,
    borderRadius: radius.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  heading: { ...type.heading, color: colors.text },
  caption: { ...type.caption, color: colors.muted },
});
