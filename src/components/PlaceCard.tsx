import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ImageStyle,
  type StyleProp,
} from 'react-native';

import { useEnrichedPlace } from '@/lib/googlePlaces';
import { formatPriceLevel, milesFromCampus } from '@/lib/places';
import type { Candidate } from '@/lib/types';

import { colors, fonts } from './theme';

/** "Mill Pond Bakery, Italian, price 2 of 4, 1.2 mi away" for screen readers. */
export function describePlace(place: Candidate): string {
  const parts = [place.name];
  if (place.cuisine) parts.push(place.cuisine);
  const price = formatPriceLevel(place.priceLevel);
  if (price) parts.push(`price ${price.length} of 4`);
  const miles = milesFromCampus(place);
  if (miles) parts.push(`${miles} from campus`);
  return parts.join(', ');
}

export function PlacePhoto({ uri, style }: { uri: string | null; style?: StyleProp<ImageStyle> }) {
  return uri ? (
    <Image source={{ uri }} style={[styles.photo, style]} resizeMode="cover" accessible={false} />
  ) : (
    <LinearGradient colors={['#3A2A4A', '#1B1622']} style={[styles.photo, style]} />
  );
}

export function Chips({ place, light = true }: { place: Candidate; light?: boolean }) {
  const price = formatPriceLevel(place.priceLevel);
  const miles = milesFromCampus(place);
  const chips: { icon: keyof typeof Ionicons.glyphMap; text: string }[] = [];
  if (place.rating !== null) chips.push({ icon: 'star', text: place.rating.toFixed(1) });
  if (place.cuisine) chips.push({ icon: 'restaurant', text: place.cuisine });
  if (price) chips.push({ icon: 'cash-outline', text: price });
  if (miles) chips.push({ icon: 'location-sharp', text: miles });
  return (
    <View style={styles.chips}>
      {chips.map((c) => (
        <View key={c.text} style={[styles.chip, !light && styles.chipDark]}>
          <Ionicons name={c.icon} size={13} color={colors.text} />
          <Text style={styles.chipText}>{c.text}</Text>
        </View>
      ))}
    </View>
  );
}

/** Full-bleed photo card with the name and chips over a dark gradient. */
export function PlaceCard({ place: base, onInfo }: { place: Candidate; onInfo?: () => void }) {
  const place = useEnrichedPlace(base);
  return (
    <View style={styles.card}>
      <PlacePhoto uri={place.photoUrl} style={StyleSheet.absoluteFill} />
      <LinearGradient
        colors={['transparent', 'rgba(8,6,12,0.35)', 'rgba(8,6,12,0.92)']}
        locations={[0.35, 0.6, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.info}>
        <Pressable
          onPress={onInfo}
          disabled={!onInfo}
          accessibilityRole={onInfo ? 'button' : undefined}
          accessibilityHint={onInfo ? 'Shows photos, hours and more' : undefined}
          style={onInfo ? styles.nameRow : undefined}
        >
          <Text style={[styles.name, onInfo && { flex: 1 }]} numberOfLines={2}>
            {place.name}
          </Text>
          {onInfo ? (
            <View style={styles.infoBtn}>
              <Ionicons name="arrow-up" size={20} color="#0E0B12" />
            </View>
          ) : null}
        </Pressable>
        {place.address ? (
          <Text style={styles.address} numberOfLines={1}>
            {place.address}
          </Text>
        ) : null}
        <Chips place={place} />
      </View>
      {place.photoCredit ? <Text style={styles.credit}>Photo: {place.photoCredit}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: colors.card,
  },
  photo: { backgroundColor: colors.cardHi },
  nameRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  infoBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginBottom: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  info: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 22, gap: 6 },
  name: {
    fontFamily: fonts.black,
    fontSize: 30,
    lineHeight: 36,
    color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowRadius: 8,
  },
  address: { fontFamily: fonts.medium, fontSize: 14, color: 'rgba(255,255,255,0.8)' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  chipDark: { backgroundColor: colors.cardHi, borderColor: colors.border },
  credit: {
    position: 'absolute',
    top: 12,
    right: 14,
    fontFamily: fonts.medium,
    fontSize: 10,
    color: 'rgba(255,255,255,0.75)',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 4,
  },
  chipText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.text },
});
