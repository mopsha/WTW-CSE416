// Discover: bounded individual feed; preserve local fixture presentation in mock mode.
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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

import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { discoverPlace } from '@/lib/discoverFeed';
import { messageOf } from '@/lib/errors';
import { PlaceFilterControls } from '@/components/PlaceFilterControls';
import { ErrorState } from '@/components/ErrorState';
import { Button } from '@/components/Button';
import { Chips as ChipGroup } from '@/components/Chips';
import { QuietEmpty, Sheet } from '@/components/TabUi';
import { describePlace, PlacePhoto } from '@/components/PlaceCard';
import { colors, fonts, MIN_TARGET, radius, space, surfaces, type } from '@/components/theme';
import {
  filterDiscover,
  milesLabel,
  type DiscoverFilter,
  type DiscoverPlace,
} from '@/lib/discover';
import { haptic } from '@/lib/haptics';
import { CAMPUS, formatPriceLevel, formatRating } from '@/lib/places';
import { directionsUrl } from '@/lib/pickUi';

const EMPTY_PLACES: DiscoverPlace[] = [];

const FILTERS = [
  { value: 'all' as const, label: 'For You' },
  { value: 'food' as const, label: 'Food' },
  { value: 'activities' as const, label: 'Activities' },
];

/** Render supplied feed imagery without adding provider requests or invented photos. */
function Cover({ place, style }: { place: DiscoverPlace; style: object; big?: boolean }) {
  return (
    <View style={[style, { overflow: 'hidden' }]}>
      {place.photoUrl ? (
        <PlacePhoto uri={place.photoUrl} style={StyleSheet.absoluteFill} />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.emojiCover]}>
          <Ionicons
            name={place.category === 'food' ? 'restaurant-outline' : 'compass-outline'}
            size={42}
            color={colors.muted}
          />
        </View>
      )}
    </View>
  );
}
function PlaceTile({
  place,
  onPress,
  onSave,
  saved,
  busy,
  ready,
}: {
  place: DiscoverPlace;
  onPress: () => void;
  onSave: () => void;
  saved: boolean;
  busy: boolean;
  ready: boolean;
}) {
  const details = [place.kind, milesLabel(place.miles), formatPriceLevel(place.priceLevel)]
    .filter(Boolean)
    .join(' · ');
  return (
    <View style={[styles.tile, !place.photoUrl && { height: 160 }]}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={describePlace(place)}
        accessibilityHint="Shows place details and directions"
        style={StyleSheet.absoluteFill}
      >
        <Cover place={place} style={StyleSheet.absoluteFill} />
        <LinearGradient
          colors={[colors.transparent, colors.photoShade]}
          locations={[0.2, 1]}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.tileInfo}>
          <Text style={styles.tileName} numberOfLines={2}>
            {place.name}
          </Text>
          <View style={styles.tileMetaRow}>
            <Text style={styles.tileMeta} numberOfLines={1}>
              {details}
            </Text>
            {place.rating !== null ? (
              <Text style={styles.tileRating}>{formatRating(place.rating)}</Text>
            ) : null}
          </View>
        </View>
      </Pressable>
      <Pressable
        onPress={onSave}
        disabled={!ready || busy}
        accessibilityRole="button"
        accessibilityLabel={`${saved ? 'Unsave' : 'Save'} ${place.name}`}
        accessibilityState={{ selected: saved, disabled: !ready || busy, busy }}
        style={styles.bookmark}
      >
        {busy ? (
          <ActivityIndicator color={colors.photoText} />
        ) : (
          <Ionicons
            name={saved ? 'bookmark' : 'bookmark-outline'}
            size={23}
            color={colors.photoText}
          />
        )}
      </Pressable>
    </View>
  );
}

function PlaceSheet({
  place,
  onClose,
  onSaved,
}: {
  place: DiscoverPlace | null;
  onClose: () => void;
  onSaved: (id: string, saved: boolean) => void;
}) {
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    if (place)
      api
        .getSaved()
        .then((result) => {
          if (active) {
            setSaved(result.places.some((p) => p.placeId === place.placeId));
            setReady(true);
          }
        })
        .catch((e) => {
          if (active) setError(messageOf(e));
        });
    return () => {
      active = false;
    };
  }, [place]);
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
              <Ionicons name="close" size={22} color={colors.primaryText} />
            </Pressable>
            <View style={styles.sheetBody}>
              <Text style={styles.sheetName} accessibilityRole="header">
                {place.name}
              </Text>
              {place.address ? <Text style={styles.sheetAddress}>{place.address}</Text> : null}
              {place.providerCredits?.length ? (
                <Text style={styles.sub}>{[...new Set(place.providerCredits)].join(' · ')}</Text>
              ) : null}
              <View style={styles.pills} accessible={false}>
                {[
                  place.kind,
                  formatRating(place.rating),
                  formatPriceLevel(place.priceLevel),
                  milesLabel(place.miles),
                ]
                  .filter(Boolean)
                  .map((t) => (
                    <View key={t} style={styles.pill}>
                      <Text style={styles.pillText}>{t}</Text>
                    </View>
                  ))}
              </View>
              {error ? <ErrorState message={error} /> : null}
              <Button
                label={saved ? 'Remove saved place' : 'Save place'}
                variant="secondary"
                icon="bookmark-outline"
                loading={busy}
                disabled={!ready}
                onPress={() => {
                  setBusy(true);
                  setError(null);
                  void (saved ? api.removeSaved(place.placeId) : api.savePlace(place.placeId))
                    .then(() => {
                      setSaved(!saved);
                      onSaved(place.placeId, !saved);
                    })
                    .catch((e) => setError(messageOf(e)))
                    .finally(() => setBusy(false));
                }}
              />
              <Button
                label="Get directions"
                icon="navigate-outline"
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
  const { session } = useAuth();
  const userId = session?.user.id;
  const [response, setResponse] = useState<{
    key: string;
    places: DiscoverPlace[];
    notice: string | null;
    error: string | null;
  } | null>(null);
  const [retry, setRetry] = useState(0);
  const [priceMax, setPriceMax] = useState(-1);
  const [openNow, setOpenNow] = useState(false);
  const [radiusM, setRadiusM] = useState(5000);
  const [filter, setFilter] = useState<DiscoverFilter>('all');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<DiscoverPlace | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draftPrice, setDraftPrice] = useState(-1);
  const [draftRadius, setDraftRadius] = useState(5000);
  const [draftOpen, setDraftOpen] = useState(false);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [savedFor, setSavedFor] = useState<string | undefined>(undefined);
  const [savedReady, setSavedReady] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    api
      .getSaved()
      .then((result) => {
        if (active) {
          setSavedIds(new Set(result.places.map((p) => p.placeId)));
          setSavedReady(true);
          setSavedFor(userId);
        }
      })
      .catch((e) => {
        if (active) setSaveError(messageOf(e));
      });
    return () => {
      active = false;
    };
  }, [userId, retry]);
  const updateSaved = (id: string, saved: boolean) =>
    setSavedIds((ids) => {
      const next = new Set(ids);
      if (saved) next.add(id);
      else next.delete(id);
      return next;
    });
  const savePlace = async (place: DiscoverPlace) => {
    if (saving || !savedReady || savedFor !== userId) return;
    const wasSaved = savedIds.has(place.placeId);
    setSaving(place.placeId);
    setSaveError(null);
    try {
      await (wasSaved ? api.removeSaved(place.placeId) : api.savePlace(place.placeId));
      updateSaved(place.placeId, !wasSaved);
    } catch (e) {
      setSaveError(messageOf(e));
    } finally {
      setSaving(null);
    }
  };

  const requestKey = JSON.stringify([filter, radiusM, priceMax, openNow, retry, userId]);
  const current = response?.key === requestKey ? response : null;
  const feed = current?.places ?? EMPTY_PLACES;
  const notice = current?.notice ?? null;
  const error = current?.error ?? null;
  const loading = !current;
  useEffect(() => {
    let active = true;
    api
      .discover({
        ...CAMPUS,
        category: filter,
        radiusM,
        priceMax: priceMax < 0 ? undefined : priceMax,
        openNow,
      })
      .then((result) => {
        if (active)
          setResponse({
            key: requestKey,
            places: result.places.map((p) => discoverPlace(p, CAMPUS)),
            notice: result.notice,
            error: null,
          });
      })
      .catch((e) => {
        if (active) setResponse({ key: requestKey, places: [], notice: null, error: messageOf(e) });
      });
    return () => {
      active = false;
    };
  }, [filter, radiusM, priceMax, openNow, requestKey]);

  const places = useMemo(
    () => filterDiscover(feed, { category: filter, query }),
    [feed, filter, query],
  );
  // Preserve the original photo-featured selection, now as full-width cards without duplicates.
  const displayed = useMemo(() => {
    if (query.trim()) return places;
    const featured = filterDiscover(feed, { category: filter })
      .filter((p) => p.photoUrl)
      .slice(0, 6);
    const ids = new Set(featured.map((p) => p.placeId));
    return [...featured, ...places.filter((p) => !ids.has(p.placeId))];
  }, [feed, filter, places, query]);
  const show = (p: DiscoverPlace) => {
    haptic.tap();
    setOpen(p);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <FlatList
        data={displayed}
        keyExtractor={(p) => p.placeId}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.content}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        renderItem={({ item }) => (
          <PlaceTile
            place={item}
            onPress={() => show(item)}
            onSave={() => void savePlace(item)}
            saved={savedFor === userId && savedIds.has(item.placeId)}
            busy={saving === item.placeId}
            ready={savedFor === userId && savedReady && saving === null}
          />
        )}
        ListHeaderComponent={
          <View style={{ gap: 16, marginBottom: 14 }}>
            <View style={{ gap: 4 }}>
              <Text style={styles.eyebrow}>AROUND STONY BROOK</Text>
              <Text style={styles.h1} accessibilityRole="header">
                Discover
              </Text>
              <Text style={styles.sub}>
                {loading ? 'Finding places…' : 'Find places to eat, hang out, and more.'}
              </Text>
            </View>

            <View style={styles.search}>
              <Ionicons name="search" size={18} color={colors.muted} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search food, activities, places…"
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
                  hitSlop={4}
                  style={styles.searchClear}
                >
                  <Ionicons name="close-circle" size={18} color={colors.muted} />
                </Pressable>
              ) : null}
            </View>

            <View
              style={styles.categories}
              accessibilityRole="tablist"
              accessibilityLabel="Discover category"
            >
              {FILTERS.map((f, i) => (
                <Pressable
                  key={f.value}
                  accessibilityRole="tab"
                  accessibilityLabel={f.label}
                  accessibilityState={{ selected: filter === f.value }}
                  onPress={() => setFilter(f.value)}
                  style={[
                    styles.categoryControl,
                    filter === f.value && {
                      backgroundColor: colors.primary,
                      borderColor: colors.primary,
                    },
                  ]}
                >
                  <Ionicons
                    name={
                      i === 0 ? 'sparkles-outline' : i === 1 ? 'restaurant-outline' : 'walk-outline'
                    }
                    size={18}
                    color={colors.text}
                  />
                  <Text style={styles.filterText}>{f.label}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.filterRow}>
              <Pressable
                accessibilityRole="switch"
                accessibilityLabel="Open Now"
                accessibilityState={{ checked: openNow }}
                onPress={() => setOpenNow(!openNow)}
                style={[styles.filterControl, openNow && styles.filterSelected]}
              >
                <Ionicons
                  name="time-outline"
                  size={19}
                  color={openNow ? colors.primary : colors.text}
                />
                <Text style={styles.filterText}>Open Now</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Filters"
                onPress={() => {
                  setDraftPrice(priceMax);
                  setDraftRadius(radiusM);
                  setDraftOpen(openNow);
                  setFiltersOpen(true);
                }}
                style={styles.filterControl}
              >
                <Ionicons name="options-outline" size={19} color={colors.text} />
                <Text style={styles.filterText}>
                  Filters{priceMax >= 0 || radiusM !== 5000 ? ' · On' : ''}
                </Text>
              </Pressable>
            </View>
            {notice ? (
              <Text style={styles.sub}>{notice}</Text>
            ) : current && !error ? (
              <Text style={styles.sub}>Places from Google Maps</Text>
            ) : null}
            {error ? <ErrorState message={error} onRetry={() => setRetry((n) => n + 1)} /> : null}
            <Text style={styles.section}>
              {query.trim()
                ? `${places.length} result${places.length === 1 ? '' : 's'}`
                : 'Near campus'}
            </Text>
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.primary} accessibilityLabel="Loading places" />
          ) : error ? null : (
            <QuietEmpty
              icon="search-outline"
              title="Nothing matches"
              body="Try another search, or change your filters."
            />
          )
        }
      />
      {saveError ? (
        <View style={{ paddingHorizontal: space.xl }}>
          <ErrorState message={saveError} onRetry={() => setRetry((n) => n + 1)} />
        </View>
      ) : null}
      <Sheet visible={filtersOpen} title="Filters" onClose={() => setFiltersOpen(false)}>
        <Text style={styles.section}>Price and opening hours</Text>
        <PlaceFilterControls
          priceMax={draftPrice}
          openNow={draftOpen}
          onPrice={setDraftPrice}
          onOpen={setDraftOpen}
        />
        <Text style={styles.section}>Distance</Text>
        <ChipGroup
          options={[
            { value: 1000, label: '1 km' },
            { value: 5000, label: '5 km' },
            { value: 16000, label: '16 km' },
          ]}
          value={draftRadius}
          onChange={setDraftRadius}
          accessibilityLabel="Search radius"
        />
        <Button
          label="Show places"
          onPress={() => {
            setPriceMax(draftPrice);
            setRadiusM(draftRadius);
            setOpenNow(draftOpen);
            setFiltersOpen(false);
          }}
        />
        <Button
          label="Reset filters"
          variant="link"
          onPress={() => {
            setDraftPrice(-1);
            setDraftRadius(5000);
            setDraftOpen(false);
          }}
        />
      </Sheet>
      <PlaceSheet
        key={`${userId}:${open?.placeId}`}
        place={feed.some((p) => p.placeId === open?.placeId) ? open : null}
        onClose={() => setOpen(null)}
        onSaved={updateSaved}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  categories: { flexDirection: 'row', gap: space.sm },
  categoryControl: {
    ...surfaces.control,
    flex: 1,
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TARGET,
    borderRadius: radius.pill,
  },
  tile: { height: 180, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.card },
  tileInfo: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    bottom: space.lg,
    gap: space.xs,
  },
  tileName: { ...type.heading, color: colors.photoText },
  tileMetaRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  tileMeta: { ...type.caption, color: colors.photoMuted, flex: 1 },
  tileRating: { ...type.caption, color: colors.photoText },
  bookmark: {
    position: 'absolute',
    top: space.sm,
    right: space.sm,
    width: MIN_TARGET,
    height: MIN_TARGET,
    borderRadius: radius.sm,
    backgroundColor: colors.scrim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterRow: { flexDirection: 'row', gap: space.md },
  filterControl: {
    ...surfaces.control,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: MIN_TARGET,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
  },
  filterSelected: { borderColor: colors.primary },
  filterText: { ...type.caption, fontFamily: fonts.semibold, color: colors.text },
  searchClear: {
    minWidth: MIN_TARGET,
    minHeight: MIN_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingBottom: 40 },
  eyebrow: { fontFamily: fonts.bold, fontSize: 13, letterSpacing: 2, color: colors.muted },
  h1: { fontFamily: fonts.bold, fontSize: 32, lineHeight: 40, color: colors.text },
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
  emojiCover: { backgroundColor: colors.cardHi, alignItems: 'center', justifyContent: 'center' },
  pressed: { transform: [{ scale: 0.98 }], opacity: 0.9 },
  backdrop: { flex: 1, backgroundColor: colors.scrim },
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
    backgroundColor: colors.scrim,
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
  sheetName: { fontFamily: fonts.bold, fontSize: 26, lineHeight: 32, color: colors.text },
  sheetAddress: { fontFamily: fonts.medium, fontSize: 15, color: colors.muted },
});
