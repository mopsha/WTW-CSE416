import { Image, StyleSheet, Text, View } from 'react-native';

import { formatPriceLevel } from '@/lib/places';
import type { Candidate } from '@/lib/types';

import { colors } from './theme';

/** "Mill Pond Bakery, $, rated 4.8 out of 5" for screen readers. */
export function describePlace(place: Candidate): string {
  const parts = [place.name];
  const price = formatPriceLevel(place.priceLevel);
  if (price) parts.push(`price ${price.length} of 4`);
  if (place.rating !== null) parts.push(`rated ${place.rating.toFixed(1)} out of 5`);
  return parts.join(', ');
}

export function PlaceMeta({ place }: { place: Candidate }) {
  const price = formatPriceLevel(place.priceLevel);
  const bits = [price, place.rating !== null ? `★ ${place.rating.toFixed(1)}` : null].filter(
    Boolean,
  );
  return bits.length ? <Text style={styles.meta}>{bits.join('  ·  ')}</Text> : null;
}

export function PlacePhoto({ uri, style }: { uri: string | null; style?: object }) {
  return uri ? (
    <Image source={{ uri }} style={[styles.photo, style]} resizeMode="cover" accessible={false} />
  ) : (
    <View style={[styles.photo, styles.placeholder, style]} />
  );
}

/** Photo, name, price level and rating. Used inside the swipe card. */
export function PlaceCard({ place }: { place: Candidate }) {
  return (
    <View style={styles.card}>
      <PlacePhoto uri={place.photoUrl} style={styles.cardPhoto} />
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={2}>
          {place.name}
        </Text>
        <PlaceMeta place={place} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  photo: { backgroundColor: colors.border },
  placeholder: { backgroundColor: '#D9DEEA' },
  cardPhoto: { flex: 1, minHeight: 140 },
  info: { padding: 16, gap: 4 },
  name: { fontSize: 22, fontWeight: '700', color: colors.text },
  meta: { fontSize: 16, color: colors.muted },
});
