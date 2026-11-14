import { useLayoutEffect, useRef, useState } from 'react';
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
import { formatPriceLevel, milesFromCampus, openLabel } from '@/lib/places';
import type { Candidate } from '@/lib/types';

import { GoogleCredit } from './GoogleCredit';
import { colors, fonts } from './theme';

/** "Mill Pond Bakery, Italian, price 2 of 4, 1.2 mi away" for screen readers. */
export function describePlace(place: Candidate): string {
  const parts = [place.name];
  if (place.origin === 'group_idea') parts.push('Our Idea');
  if (place.cuisine) parts.push(place.cuisine);
  if (place.note) parts.push(place.note);
  if (place.rating) parts.push(`rated ${place.rating.toFixed(1)} of 5`);
  const price = formatPriceLevel(place.priceLevel);
  if (price) parts.push(`price ${price.length} of 4`);
  const miles = milesFromCampus(place);
  if (miles) parts.push(`${miles} from campus`);
  return parts.join(', ');
}

/** Source-keyed image instances cannot settle a replacement source's loading state. */
export function PlacePhoto({ uri, style }: { uri: string | null; style?: StyleProp<ImageStyle> }) {
  return (
    <View
      style={[styles.photo, style]}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <PlacePhotoContent key={uri ?? 'no-photo'} uri={uri} />
    </View>
  );
}
function PlacePhotoContent({ uri }: { uri: string | null }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const active = useRef(true);
  const rejected = useRef(false);
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  return (
    <>
      {!loaded ? (
        <View style={[StyleSheet.absoluteFill, styles.photoPlaceholder]}>
          <Ionicons name="image-outline" size={24} color={colors.muted} />
        </View>
      ) : null}
      {uri && !failed ? (
        <Image
          source={{ uri }}
          resizeMode="cover"
          accessible={false}
          style={[StyleSheet.absoluteFill, { opacity: loaded ? 1 : 0 }]}
          onLoad={() => {
            if (active.current && !rejected.current) setLoaded(true);
          }}
          onError={() => {
            if (!active.current) return;
            rejected.current = true;
            setLoaded(false);
            setFailed(true);
          }}
        />
      ) : null}
    </>
  );
}

export function Chips({ place, light = true }: { place: Candidate; light?: boolean }) {
  const price = formatPriceLevel(place.priceLevel);
  const miles = milesFromCampus(place);
  const chips: { icon: keyof typeof Ionicons.glyphMap; text: string }[] = [];
  if (place.origin === 'group_idea') chips.push({ icon: 'people-outline', text: 'Our Idea' });
  if (place.rating !== null) chips.push({ icon: 'star', text: place.rating.toFixed(1) });
  if (place.cuisine) chips.push({ icon: 'restaurant', text: place.cuisine });
  if (price) chips.push({ icon: 'cash-outline', text: price });
  if (miles) chips.push({ icon: 'location-sharp', text: miles });
  // Only known at reveal (finalists/winner get fresh hours), so the deck rarely shows it.
  const open = openLabel(place);
  if (open) chips.push({ icon: place.openNow ? 'time' : 'moon', text: open });
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
        {place.note ? <Text style={styles.address}>{place.note}</Text> : null}
        {place.address ? (
          <Text style={styles.address} numberOfLines={1}>
            {place.address}
          </Text>
        ) : null}
        <Chips place={place} />
      </View>
      {place.photoCredit ? <Text style={styles.credit}>Photo: {place.photoCredit}</Text> : null}
      {!place.photoCredit ? <GoogleCredit place={place} light style={styles.googleCredit} /> : null}
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
  photo: { backgroundColor: colors.cardHi, overflow: 'hidden' },
  photoPlaceholder: { alignItems: 'center', justifyContent: 'center' },
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
  googleCredit: { position: 'absolute', top: 12, right: 14 },
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
