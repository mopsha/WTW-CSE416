// Ranked finalists and the persisted winner. Ranks only; never scores.
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useEnrichedPlace } from '@/lib/googlePlaces';
import { ordinal } from '@/lib/places';
import { GoogleCredit } from './GoogleCredit';
import type { Candidate } from '@/lib/types';

import { Chips, describePlace, PlacePhoto } from './PlaceCard';
import { colors, fonts, MIN_TARGET, radius, space, type } from './theme';
import { Card } from './Card';

export function WinnerCard({
  place: base,
  badge = 'The pick',
}: {
  place: Candidate;
  badge?: string;
}) {
  const place = useEnrichedPlace(base);
  return (
    <View>
      <Card style={styles.winnerCard}>
        {place.photoUrl ? <PlacePhoto uri={place.photoUrl} style={styles.winnerPhoto} /> : null}
        <View style={styles.winnerInfo}>
          <Text style={styles.crownText}>{badge}</Text>
          <Text style={styles.winnerName} accessibilityRole="header">
            {place.name}
          </Text>
          {place.address ? <Text style={styles.addr}>{place.address}</Text> : null}
          {place.note ? <Text style={styles.addr}>{place.note}</Text> : null}
          <Chips place={place} light={false} />
          {place.photoCredit ? <Text style={styles.credit}>Photo: {place.photoCredit}</Text> : null}
        </View>
      </Card>
      <GoogleCredit place={place} style={styles.creditRow} />
    </View>
  );
}

/** A finalist: full-bleed photo, rank badge, name + chips. Optional right-side slot (vote mark). */
export function BigResult({
  place: base,
  rank,
  onPress,
  selected,
  accessibilityLabel,
  accessibilityHint,
  footer,
}: {
  place: Candidate;
  rank: number;
  onPress?: () => void;
  selected?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  footer?: ReactNode;
}) {
  const place = useEnrichedPlace(base);
  const label = accessibilityLabel ?? `${ordinal(rank)}: ${describePlace(place)}`;
  return (
    <View>
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        accessibilityRole={onPress ? 'radio' : 'summary'}
        accessibilityState={onPress ? { selected: !!selected } : undefined}
        accessibilityLabel={label}
        accessibilityHint={accessibilityHint}
        style={({ pressed }) => [
          styles.bigResult,
          selected && styles.bigSelected,
          pressed && onPress && { transform: [{ scale: 0.98 }] },
        ]}
      >
        <PlacePhoto uri={place.photoUrl} style={styles.bigPhoto} />
        <LinearGradient
          colors={['transparent', 'rgba(8,6,12,0.92)']}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.rankBadge}>
          <Text style={styles.rankText}>{ordinal(rank)}</Text>
        </View>
        {selected ? (
          <View style={styles.check}>
            <Ionicons name="checkmark" size={20} color="#0E0B12" />
          </View>
        ) : null}
        <View style={styles.bigInfo}>
          <Text style={styles.bigName} numberOfLines={2}>
            {place.name}
          </Text>
          <Chips place={place} />
          {footer}
        </View>
      </Pressable>
      <GoogleCredit place={place} style={styles.creditRow} />
    </View>
  );
}

export function SmallResult({
  place: base,
  rank,
  onPress,
}: {
  place: Candidate;
  rank: number;
  onPress?: () => void;
}) {
  const place = useEnrichedPlace(base);
  return (
    <View>
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        accessibilityRole={onPress ? 'button' : 'summary'}
        accessibilityLabel={`${ordinal(rank)}: ${describePlace(place)}`}
        style={styles.small}
      >
        <PlacePhoto uri={place.photoUrl} style={styles.smallPhoto} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.smallRank}>{ordinal(rank).toUpperCase()}</Text>
          <Text style={styles.smallName} numberOfLines={2}>
            {place.name}
          </Text>
          {place.origin === 'group_idea' ? <Text style={styles.smallMeta}>Our Idea</Text> : null}
          {place.cuisine ? <Text style={styles.smallMeta}>{place.cuisine}</Text> : null}
        </View>
        {onPress ? <Ionicons name="navigate" size={20} color={colors.muted} /> : null}
      </Pressable>
      <GoogleCredit place={place} style={styles.creditRow} />
    </View>
  );
}

const styles = StyleSheet.create({
  winnerCard: { padding: 0, gap: 0, overflow: 'hidden' },
  winnerPhoto: { width: '100%', height: 190 },
  crownText: { ...type.caption, fontFamily: fonts.semibold, color: colors.primary },
  winnerInfo: { padding: space.lg, gap: space.sm },
  creditRow: { marginTop: 6, paddingHorizontal: 4 },
  credit: { fontFamily: fonts.medium, fontSize: 10, color: colors.muted },
  addr: { fontFamily: fonts.medium, fontSize: 14, color: colors.muted },
  winnerName: { ...type.heading, color: colors.text },
  bigResult: {
    minHeight: 190,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: colors.card,
    borderWidth: 3,
    borderColor: 'transparent',
  },
  bigSelected: { borderColor: colors.yes },
  bigPhoto: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  rankBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    backgroundColor: 'rgba(14,11,18,0.8)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
  },
  rankText: { fontFamily: fonts.black, fontSize: 14, color: '#FFD23F' },
  check: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.yes,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigInfo: { marginTop: 'auto', padding: 16, paddingTop: 70, gap: 4 },
  bigName: { fontFamily: fonts.black, fontSize: 22, lineHeight: 28, color: '#FFFFFF' },
  small: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    minHeight: MIN_TARGET + 20,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  smallPhoto: { width: 64, height: 64, borderRadius: 14 },
  smallRank: { fontFamily: fonts.black, fontSize: 12, color: colors.muted, letterSpacing: 1 },
  smallName: { fontFamily: fonts.bold, fontSize: 16, color: colors.text },
  smallMeta: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted },
});
