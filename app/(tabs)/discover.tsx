import { PlaceCardsSkeleton } from '@/components/LoadingStates';
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
import { isAccessDenied, messageOf } from '@/lib/errors';
import { DiscoverFilterSheet } from '@/components/DiscoverFilterSheet';
import {
  activeFilterCount,
  defaultDiscoverFilters,
  discoverFilterParams,
  resetDiscoverFilters,
  DISCOVER_SORTS,
  type DiscoverSort,
} from '@/lib/discoverFilters';
import { ErrorState } from '@/components/ErrorState';
import { Button } from '@/components/Button';
import { QuietEmpty, Sheet } from '@/components/TabUi';
import { describePlace, PlacePhoto } from '@/components/PlaceCard';
import { colors, fonts, MIN_TARGET, radius, space, type } from '@/components/theme';
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
    <View style={styles.tile}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={describePlace(place)}
        accessibilityHint="Shows place details and directions"
        style={[styles.tileMain, !place.photoUrl && styles.tileWithoutPhoto]}
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
            <Text style={styles.tileMeta}>{details}</Text>
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
  const userId = session?.user.id ?? '';
  return <DiscoverFeed key={userId} userId={userId} />;
}
function DiscoverFeed({ userId }: { userId: string }) {
  const [response, setResponse] = useState<{
    key: string;
    scope: string;
    places: DiscoverPlace[];
    notice: string | null;
    error: string | null;
  } | null>(null);
  const [retry, setRetry] = useState(0);
  const [applied, setApplied] = useState(defaultDiscoverFilters);
  const [sort, setSort] = useState<DiscoverSort>('recommended');
  const [sortOpen, setSortOpen] = useState(false);
  const { openNow } = applied;
  const [filter, setFilter] = useState<DiscoverFilter>('all');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<DiscoverPlace | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [savedFor, setSavedFor] = useState<string | undefined>(undefined);
  const [savedReady, setSavedReady] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  useEffect(() => {
    if (!userId) return;
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

  const params = useMemo(
    () => ({
      ...CAMPUS,
      category: filter,
      ...discoverFilterParams(applied, filter),
      ...(sort !== 'recommended' ? { sort } : {}),
    }),
    [applied, filter, sort],
  );
  const scope = JSON.stringify([params, userId]);
  const requestKey = JSON.stringify([scope, retry]);
  const current = response?.key === requestKey ? response : null;
  // A same-query refresh may keep its places; never show old-account/filter results.
  const feed = (current ?? (response?.scope === scope ? response : null))?.places ?? EMPTY_PLACES;
  const notice = current?.notice ?? null;
  const error = current?.error ?? null;
  const loading = !current;
  const count = activeFilterCount(applied, filter);
  useEffect(() => {
    if (!userId) return;
    let active = true;
    const [requestParams] = JSON.parse(scope) as [Parameters<typeof api.discover>[0], string];
    api
      .discover(requestParams)
      .then((result) => {
        if (active)
          setResponse({
            key: requestKey,
            scope,
            places: result.places.map((p) => discoverPlace(p, CAMPUS)),
            notice: result.notice,
            error: null,
          });
      })
      .catch((e) => {
        if (active)
          setResponse((previous) => ({
            key: requestKey,
            scope,
            places: !isAccessDenied(e) && previous?.scope === scope ? previous.places : [],
            notice: null,
            error: messageOf(e),
          }));
      });
    return () => {
      active = false;
    };
  }, [requestKey, scope, userId]);

  const places = useMemo(
    () => filterDiscover(feed, { category: filter, query }),
    [feed, filter, query],
  );
  // Preserve the original photo-featured selection, now as full-width cards without duplicates.
  const displayed = useMemo(() => {
    if (query.trim() || count || sort !== 'recommended') return places;
    const featured = filterDiscover(feed, { category: filter })
      .filter((p) => p.photoUrl)
      .slice(0, 6);
    const ids = new Set(featured.map((p) => p.placeId));
    return [...featured, ...places.filter((p) => !ids.has(p.placeId))];
  }, [feed, filter, places, query, count, sort]);
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
        ItemSeparatorComponent={() => <View style={{ height: space.md }} />}
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
          <View style={styles.feedHeader}>
            <View style={styles.heading}>
              <Text style={styles.h1} accessibilityRole="header">
                Discover
              </Text>
              <View style={styles.location}>
                <Ionicons name="location-outline" size={14} color={colors.muted} />
                <Text style={styles.eyebrow}>AROUND STONY BROOK</Text>
              </View>
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

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.categories}
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
                  style={[styles.categoryControl, filter === f.value && styles.categorySelected]}
                >
                  <Ionicons
                    name={
                      i === 0 ? 'sparkles-outline' : i === 1 ? 'restaurant-outline' : 'walk-outline'
                    }
                    size={17}
                    color={filter === f.value ? colors.bg : colors.text}
                  />
                  <Text
                    style={[styles.categoryText, filter === f.value && styles.categorySelectedText]}
                  >
                    {f.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            <View style={styles.filterRow}>
              <Pressable
                accessibilityRole="switch"
                accessibilityLabel="Open Now"
                accessibilityState={{ checked: openNow }}
                onPress={() => setApplied((current) => ({ ...current, openNow: !current.openNow }))}
                style={[styles.filterControl, openNow && styles.filterSelected]}
              >
                <Ionicons
                  name="time-outline"
                  size={19}
                  color={openNow ? colors.primary : colors.text}
                />
                <Text style={[styles.filterText, openNow && styles.filterSelectedText]}>
                  Open Now
                </Text>
                {openNow ? <Ionicons name="checkmark" size={16} color={colors.primary} /> : null}
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Filters"
                accessibilityHint={count ? `${count} active filters` : 'No active filters'}
                onPress={() => {
                  setFiltersOpen(true);
                }}
                style={styles.filterControl}
              >
                <Ionicons name="options-outline" size={19} color={colors.text} />
                <Text style={styles.filterText}>Filters{count ? ` · ${count}` : ''}</Text>
              </Pressable>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Sort places"
              onPress={() => setSortOpen(true)}
              style={styles.filterControl}
            >
              <Ionicons name="swap-vertical-outline" size={18} color={colors.muted} />
              <Text style={styles.filterText}>
                {DISCOVER_SORTS.find((o) => o.value === sort)?.label}
              </Text>
              <Ionicons name="chevron-down" size={16} color={colors.muted} />
            </Pressable>
            <Text style={styles.sub}>
              Sort and search cover this limited selection of nearby places.
            </Text>
            {error ? <ErrorState message={error} onRetry={() => setRetry((n) => n + 1)} /> : null}
            <View style={styles.feedIntro}>
              <Text style={styles.feedTitle} accessibilityRole="header">
                {query.trim()
                  ? `${places.length} result${places.length === 1 ? '' : 's'}`
                  : 'Near campus'}
              </Text>
              {notice ? (
                <Text style={styles.sub}>{notice}</Text>
              ) : current && !error ? (
                <Text style={styles.sub}>Places from Google Maps</Text>
              ) : loading ? (
                <Text style={styles.sub}>Finding places…</Text>
              ) : null}
            </View>
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <PlaceCardsSkeleton />
          ) : error ? null : (
            <View style={{ gap: space.sm }}>
              <QuietEmpty
                icon="search-outline"
                title="No places match your filters."
                body="Try another search, or adjust the filters for this nearby selection."
              />
              <Button
                label="Adjust filters"
                variant="secondary"
                onPress={() => setFiltersOpen(true)}
              />
              <Button
                label="Reset filters"
                variant="link"
                onPress={() => {
                  setQuery('');
                  setApplied(resetDiscoverFilters(applied, filter));
                }}
              />
            </View>
          )
        }
      />
      {saveError ? (
        <View style={{ paddingHorizontal: space.xl }}>
          <ErrorState message={saveError} onRetry={() => setRetry((n) => n + 1)} />
        </View>
      ) : null}
      {filtersOpen ? (
        <DiscoverFilterSheet
          tab={filter}
          applied={applied}
          onClose={() => setFiltersOpen(false)}
          onApply={(next) => {
            setApplied(next);
            setFiltersOpen(false);
          }}
        />
      ) : null}
      <Sheet visible={sortOpen} title="Sort places" onClose={() => setSortOpen(false)}>
        <Text style={styles.sub}>
          Orders the returned nearby selection, not every nearby business. Unknown ratings and
          review counts appear last.
        </Text>
        {DISCOVER_SORTS.map((option) => (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ checked: sort === option.value }}
            onPress={() => {
              setSort(option.value);
              setSortOpen(false);
            }}
            style={({ pressed }) => [styles.filterControl, pressed && { opacity: 0.65 }]}
          >
            <Text style={[styles.filterText, sort === option.value && styles.filterSelectedText]}>
              {option.label}
            </Text>
            {sort === option.value ? (
              <Ionicons name="checkmark" size={18} color={colors.primary} />
            ) : null}
          </Pressable>
        ))}
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
  feedHeader: { gap: space.md, marginBottom: space.md },
  heading: { gap: space.xs },
  location: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  categories: { flexDirection: 'row', gap: space.sm, paddingRight: space.xs },
  categoryControl: {
    backgroundColor: colors.card,
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TARGET,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
  },
  categorySelected: { backgroundColor: colors.primary },
  categoryText: { fontSize: 15, lineHeight: 22, fontWeight: '600', color: colors.text },
  categorySelectedText: { color: colors.bg },
  tile: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.card },
  // Flowing text sets the height at larger Dynamic Type sizes; imagery remains full-bleed.
  tileMain: { minHeight: 180, justifyContent: 'flex-end', paddingTop: MIN_TARGET + space.lg },
  tileWithoutPhoto: { minHeight: 160 },
  tileInfo: { padding: space.lg, gap: space.xs },
  tileName: { ...type.heading, color: colors.photoText },
  tileMetaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  tileMeta: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.photoMuted,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 160,
  },
  tileRating: { fontSize: 14, lineHeight: 20, fontWeight: '600', color: colors.photoText },
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
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  filterControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: MIN_TARGET,
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
    borderRadius: radius.sm,
  },
  filterSelected: { backgroundColor: colors.card },
  filterSelectedText: { color: colors.primary },
  filterText: { fontSize: 14, lineHeight: 20, fontWeight: '500', color: colors.text },
  searchClear: {
    minWidth: MIN_TARGET,
    minHeight: MIN_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: space.xl - space.xs, paddingTop: space.sm, paddingBottom: 40 },
  eyebrow: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '500',
    letterSpacing: 0.6,
    color: colors.muted,
  },
  h1: {
    fontFamily: fonts.bold,
    fontSize: 28,
    lineHeight: 36,
    letterSpacing: -0.6,
    color: colors.text,
  },
  sub: { fontSize: 13, lineHeight: 19, color: colors.muted },
  feedIntro: { gap: space.xs },
  feedTitle: { fontSize: 20, lineHeight: 27, fontWeight: '700', color: colors.text },
  section: { fontFamily: fonts.bold, fontSize: 18, color: colors.text },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: MIN_TARGET,
    paddingLeft: space.md,
    paddingRight: space.xs,
    borderRadius: radius.md,
    backgroundColor: colors.card,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    minHeight: MIN_TARGET,
    paddingVertical: space.sm,
    fontSize: 17,
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
