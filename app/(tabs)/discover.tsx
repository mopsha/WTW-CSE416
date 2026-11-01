// Discover (M3): browse real places around Stony Brook. One fixed list (src/lib/discover.ts), the
// same for everyone, until the real Discover feed (FR-17) lands. Tap a place for details,
// directions, or to start a Pick.
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  FlatList,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { Chips as ChipGroup } from '@/components/Chips';
import { EmptyState } from '@/components/EmptyState';
import { GradientButton } from '@/components/GradientButton';
import { describePlace, PlacePhoto } from '@/components/PlaceCard';
import { colors, flame, fonts, MIN_TARGET } from '@/components/theme';
import {
  DISCOVER_PLACES,
  filterDiscover,
  milesLabel,
  type DiscoverFilter,
  type DiscoverPlace,
} from '@/lib/discover';
import { haptic } from '@/lib/haptics';
import { formatPriceLevel } from '@/lib/places';
import { directionsUrl } from '@/lib/pickUi';

const FILTERS = [
  { value: 'all' as const, label: 'All' },
  { value: 'food' as const, label: '🍜 Food' },
  { value: 'activities' as const, label: '🎳 Activities' },
];

/** The photo, or (for places without one) the place's emoji on the flame-tinted gradient. */
function Cover({ place, style, big }: { place: DiscoverPlace; style: object; big?: boolean }) {
  if (place.photoUrl) return <PlacePhoto uri={place.photoUrl} style={style} />;
  return (
    <LinearGradient
      colors={['#3A1E3A', '#24182E']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[style, styles.emojiCover]}
    >
      <Text style={{ fontSize: big ? 72 : 32 }} accessible={false}>
        {place.emoji}
      </Text>
    </LinearGradient>
  );
}

function meta(place: DiscoverPlace) {
  return [place.kind, formatPriceLevel(place.priceLevel), milesLabel(place.miles)]
    .filter(Boolean)
    .join(' · ');
}

function FeaturedCard({ place, onPress }: { place: DiscoverPlace; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={describePlace(place)}
      accessibilityHint="Shows details and directions"
      style={({ pressed }) => [styles.featured, pressed && styles.pressed]}
    >
      <Cover place={place} style={StyleSheet.absoluteFill} />
      <LinearGradient
        colors={['transparent', 'rgba(8,6,12,0.92)']}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.featuredInfo}>
        <Text style={styles.featuredName} numberOfLines={2}>
          {place.name}
        </Text>
        <Text style={styles.featuredMeta} numberOfLines={1}>
          {meta(place)}
        </Text>
      </View>
    </Pressable>
  );
}

function PlaceRow({ place, onPress }: { place: DiscoverPlace; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={describePlace(place)}
      accessibilityHint="Shows details and directions"
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Cover place={place} style={styles.rowCover} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.rowName} numberOfLines={2}>
          {place.name}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {meta(place)}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.muted} />
    </Pressable>
  );
}

function PlaceSheet({ place, onClose }: { place: DiscoverPlace | null; onClose: () => void }) {
  return (
    <Modal visible={!!place} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close details" />
      {place ? (
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <ScrollView contentContainerStyle={{ paddingBottom: 8 }} bounces={false}>
            <Cover place={place} style={styles.sheetCover} big />
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={styles.close}
            >
              <Ionicons name="close" size={22} color="#FFFFFF" />
            </Pressable>
            <View style={styles.sheetBody}>
              <Text style={styles.sheetName} accessibilityRole="header">
                {place.name}
              </Text>
              {place.address ? <Text style={styles.sheetAddress}>{place.address}</Text> : null}
              <View style={styles.pills} accessible={false}>
                {[
                  `${place.emoji} ${place.kind}`,
                  formatPriceLevel(place.priceLevel),
                  `📍 ${milesLabel(place.miles)}`,
                ]
                  .filter(Boolean)
                  .map((t) => (
                    <View key={t} style={styles.pill}>
                      <Text style={styles.pillText}>{t}</Text>
                    </View>
                  ))}
              </View>
              <GradientButton
                label="Get directions 🚗"
                accessibilityHint={`Opens ${Platform.OS === 'ios' ? 'Apple Maps' : 'Google Maps'}`}
                onPress={() => {
                  haptic.tap();
                  void Linking.openURL(directionsUrl(place, Platform.OS)).catch(() => {});
                }}
              />
              <Button
                label="Start a Pick with friends"
                variant="secondary"
                icon="people-outline"
                onPress={() => {
                  onClose();
                  router.push('/pick/new');
                }}
              />
            </View>
          </ScrollView>
        </SafeAreaView>
      ) : null}
    </Modal>
  );
}

export default function DiscoverScreen() {
  const [filter, setFilter] = useState<DiscoverFilter>('all');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<DiscoverPlace | null>(null);

  const places = useMemo(
    () => filterDiscover(DISCOVER_PLACES, { category: filter, query }),
    [filter, query],
  );
  // "Near campus": the closest places with photos, only when not searching.
  const featured = useMemo(
    () =>
      filterDiscover(DISCOVER_PLACES, { category: filter })
        .filter((p) => p.photoUrl)
        .slice(0, 6),
    [filter],
  );
  const showFeatured = !query.trim() && featured.length > 0;
  const show = (p: DiscoverPlace) => {
    haptic.tap();
    setOpen(p);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <FlatList
        data={places}
        keyExtractor={(p) => p.placeId}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.content}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        renderItem={({ item }) => <PlaceRow place={item} onPress={() => show(item)} />}
        ListHeaderComponent={
          <View style={{ gap: 16, marginBottom: 14 }}>
            <View style={{ gap: 4 }}>
              <Text style={styles.eyebrow}>AROUND STONY BROOK</Text>
              <Text style={styles.h1} accessibilityRole="header">
                Discover
              </Text>
              <Text style={styles.sub}>
                {DISCOVER_PLACES.length} spots near campus to eat, see and do.
              </Text>
            </View>

            <View style={styles.search}>
              <Ionicons name="search" size={18} color={colors.muted} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search tacos, beach, bowling…"
                placeholderTextColor={colors.muted}
                style={styles.searchInput}
                returnKeyType="search"
                autoCorrect={false}
                accessibilityLabel="Search places"
              />
              {query ? (
                <Pressable
                  onPress={() => setQuery('')}
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                  hitSlop={10}
                >
                  <Ionicons name="close-circle" size={18} color={colors.muted} />
                </Pressable>
              ) : null}
            </View>

            <ChipGroup
              options={FILTERS}
              value={filter}
              onChange={setFilter}
              accessibilityLabel="Show"
            />

            {showFeatured ? (
              <View style={{ gap: 10 }}>
                <Text style={styles.section}>Near campus 🔥</Text>
                <FlatList
                  horizontal
                  data={featured}
                  keyExtractor={(p) => `f-${p.placeId}`}
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 12 }}
                  renderItem={({ item }) => (
                    <FeaturedCard place={item} onPress={() => show(item)} />
                  )}
                />
              </View>
            ) : null}

            <Text style={styles.section}>
              {query.trim()
                ? `${places.length} result${places.length === 1 ? '' : 's'}`
                : 'Everything nearby'}
            </Text>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            emoji="🧭"
            title="Nothing matches"
            body="Try another word, or switch the filter to All."
          />
        }
      />
      <PlaceSheet place={open} onClose={() => setOpen(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingBottom: 40 },
  eyebrow: { fontFamily: fonts.black, fontSize: 13, letterSpacing: 3, color: flame[1] },
  h1: { fontFamily: fonts.black, fontSize: 30, lineHeight: 36, color: colors.text },
  sub: { fontFamily: fonts.medium, fontSize: 15, color: colors.muted },
  section: { fontFamily: fonts.bold, fontSize: 18, color: colors.text },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: MIN_TARGET + 4,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: {
    flex: 1,
    minHeight: MIN_TARGET,
    fontFamily: fonts.medium,
    fontSize: 16,
    color: colors.text,
  },
  featured: {
    width: 200,
    height: 230,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: colors.card,
  },
  featuredInfo: { position: 'absolute', left: 14, right: 14, bottom: 14, gap: 2 },
  featuredName: { fontFamily: fonts.black, fontSize: 18, lineHeight: 22, color: '#FFFFFF' },
  featuredMeta: { fontFamily: fonts.medium, fontSize: 13, color: 'rgba(255,255,255,0.85)' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    minHeight: MIN_TARGET + 32,
    borderRadius: 20,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowCover: { width: 64, height: 64, borderRadius: 14, overflow: 'hidden' },
  rowName: { fontFamily: fonts.bold, fontSize: 16, color: colors.text },
  rowMeta: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted },
  emojiCover: { alignItems: 'center', justifyContent: 'center' },
  pressed: { transform: [{ scale: 0.98 }], opacity: 0.9 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    maxHeight: '88%',
    backgroundColor: colors.bg,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: 'hidden',
  },
  sheetCover: { width: '100%', height: 220 },
  close: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: MIN_TARGET,
    height: MIN_TARGET,
    borderRadius: MIN_TARGET / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(14,11,18,0.7)',
  },
  sheetBody: { padding: 20, gap: 12 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.cardHi,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.text },
  sheetName: { fontFamily: fonts.black, fontSize: 26, lineHeight: 32, color: colors.text },
  sheetAddress: { fontFamily: fonts.medium, fontSize: 15, color: colors.muted },
});
