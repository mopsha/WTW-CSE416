import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { validCenter, type LatLng } from '@shared/domain/geo.ts';
import type { DiscoverArea } from '@/hooks/useDiscoverArea';
import {
  MAX_LOCATION_QUERY,
  validDiscoverLocationId,
  type DiscoverLocationSuggestion,
  type ResolvedDiscoverLocation,
} from '@shared/api/discoverLocation.ts';
import { api } from '@/lib/api';
import { USE_MOCK } from '@/lib/config';
import { haptic } from '@/lib/haptics';
import { currentLocation } from '@/lib/locationSearch';

import { Sheet } from './TabUi';
import { colors, fonts, MIN_TARGET, radius, space, type } from './theme';

const DEBOUNCE_MS = 350;
const LOCATION_TIMEOUT_MS = 8000;

interface Props {
  area: DiscoverArea | null;
  viewer: string;
  restoreError: boolean;
  onClose: () => void;
  onSelect: (location: ResolvedDiscoverLocation) => boolean;
  onCurrent: (center: LatLng) => void;
  onFallback: () => void;
}

export function DiscoverLocationSheet({
  area,
  viewer,
  restoreError,
  onClose,
  onSelect,
  onCurrent,
  onFallback,
}: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DiscoverLocationSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [searchNote, setSearchNote] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [gpsNote, setGpsNote] = useState<string | null>(null);
  const search = useRef<AbortController | null>(null);
  const resolution = useRef<AbortController | null>(null);
  const gpsId = useRef(0);
  const term = query.trim();

  useEffect(() => {
    const gps = gpsId;
    const pending = resolution;
    return () => {
      ++gps.current;
      pending.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (term.length < 2) return;
    const controller = new AbortController();
    const { signal } = controller;
    search.current = controller;
    const timer = setTimeout(() => {
      if (signal.aborted) return;
      void api
        .suggestDiscoverLocations(term, viewer, signal)
        .then(({ suggestions }) => {
          if (signal.aborted) return;
          setResults(suggestions);
          setSearchNote(
            suggestions.length
              ? null
              : 'No locations found. Try a city, ZIP code, or full address.',
          );
        })
        .catch(() => {
          if (!signal.aborted)
            setSearchNote('Location search is unavailable. Try again in a moment.');
        })
        .finally(() => {
          if (!signal.aborted) setSearching(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [term, viewer]);

  function close() {
    search.current?.abort();
    resolution.current?.abort();
    ++gpsId.current;
    onClose();
  }

  async function select(result: DiscoverLocationSuggestion) {
    if (!validDiscoverLocationId(result.id)) return;
    haptic.tap();
    ++gpsId.current;
    setLocating(false);
    setGpsNote(null);
    resolution.current?.abort();
    const controller = new AbortController();
    const { signal } = controller;
    resolution.current = controller;
    setResolvingId(result.id);
    setSearchNote(null);
    try {
      const { location } = await api.resolveDiscoverLocation(result.id, viewer, signal);
      if (signal.aborted) return;
      if (location?.id !== result.id || !onSelect(location)) throw new Error('Invalid location');
      close();
    } catch {
      if (!signal.aborted)
        setSearchNote('Couldn’t use that location. Choose another result or try again.');
    } finally {
      if (!signal.aborted) setResolvingId(null);
    }
  }

  async function locateCurrent() {
    haptic.tap();
    resolution.current?.abort();
    setResolvingId(null);
    const id = ++gpsId.current;
    setLocating(true);
    setGpsNote(null);
    let here: LatLng | null = null;
    let note: string;
    try {
      here = await currentLocation({ timeoutMs: LOCATION_TIMEOUT_MS });
      note = 'Location permission is off. Enable location in Settings or search for an area.';
    } catch {
      note = 'Couldn’t get your location. Try again or search for an area.';
    }
    if (id !== gpsId.current) return;
    if (validCenter(here)) {
      onCurrent(here);
      close();
    } else {
      setLocating(false);
      setGpsNote(note);
    }
  }

  return (
    <Sheet visible title="Search location" onClose={close}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Use my current location"
        accessibilityState={{
          selected: area?.mode === 'current',
          busy: locating,
          disabled: locating,
        }}
        accessibilityValue={
          area?.mode === 'current' && !area.device ? { text: `Showing ${area.name}` } : undefined
        }
        disabled={locating}
        onPress={() => void locateCurrent()}
        style={styles.row}
      >
        {locating ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <Ionicons name="navigate-outline" size={20} color={colors.primary} />
        )}
        <View style={styles.description}>
          <Text style={styles.label}>Use my current location</Text>
          {area?.mode === 'current' && !area.device ? (
            <Text style={styles.detail}>Showing {area.name}</Text>
          ) : null}
        </View>
        {area?.mode === 'current' ? <Check /> : null}
      </Pressable>
      {gpsNote ? (
        <Text accessibilityLiveRegion="polite" style={styles.detail}>
          {gpsNote}
        </Text>
      ) : null}
      {area?.mode === 'manual' ? (
        <View style={styles.row} accessible accessibilityLabel={`Selected location: ${area.name}`}>
          <Ionicons name="location-outline" size={20} color={colors.primary} />
          <View style={styles.description}>
            <Text style={styles.detail}>Selected location</Text>
            <Text style={styles.label}>{area.name}</Text>
          </View>
          <Check />
        </View>
      ) : null}
      {area?.mode === 'manual' || restoreError ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear saved location and use Stony Brook"
          onPress={() => {
            haptic.tap();
            onFallback();
            close();
          }}
          style={styles.row}
        >
          <Ionicons name="location-outline" size={20} color={colors.primary} />
          <Text style={[styles.label, styles.description]}>
            Clear saved location and use Stony Brook
          </Text>
        </Pressable>
      ) : null}
      <View style={styles.field}>
        <Ionicons name="search" size={18} color={colors.muted} />
        <TextInput
          value={query}
          onChangeText={(value) => {
            setQuery(value);
            if (value.trim() === term) return;
            search.current?.abort();
            resolution.current?.abort();
            setResolvingId(null);
            setResults([]);
            setSearchNote(null);
            setSearching(value.trim().length >= 2);
          }}
          accessibilityLabel="Search cities, neighborhoods, and addresses"
          placeholder="City, neighborhood, or address"
          placeholderTextColor={colors.muted}
          style={styles.input}
          autoCorrect={false}
          maxLength={MAX_LOCATION_QUERY}
          returnKeyType="search"
        />
        {searching ? (
          <ActivityIndicator color={colors.primary} accessibilityLabel="Searching locations" />
        ) : null}
      </View>
      {searchNote ? (
        <Text accessibilityLiveRegion="polite" style={styles.detail}>
          {searchNote}
        </Text>
      ) : null}
      {results.map((result) => {
        const selected = area?.placeId === result.id;
        const resolving = resolvingId === result.id;
        return (
          <Pressable
            key={result.id}
            accessibilityRole="button"
            accessibilityLabel={[result.label, result.detail].filter(Boolean).join(', ')}
            accessibilityState={{ selected, busy: resolving, disabled: resolving }}
            disabled={resolving}
            onPress={() => void select(result)}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <Ionicons name="location-outline" size={20} color={colors.primary} />
            <View style={styles.description}>
              <Text style={styles.label}>{result.label}</Text>
              <Text style={styles.detail}>{result.detail}</Text>
            </View>
            {resolving ? <ActivityIndicator color={colors.primary} /> : selected ? <Check /> : null}
          </Pressable>
        );
      })}
      {!USE_MOCK && (results.length > 0 || area?.mode === 'manual') ? (
        <DiscoverLocationAttribution providers={area?.attributions} />
      ) : null}
    </Sheet>
  );
}

export function DiscoverLocationAttribution({
  providers,
}: {
  providers?: ResolvedDiscoverLocation['attributions'];
}) {
  if (USE_MOCK) return null;
  return (
    <View style={styles.credits}>
      <Text numberOfLines={1} style={styles.attribution}>
        Google Maps
      </Text>
      {providers?.map(({ provider, providerUri }, index) =>
        providerUri ? (
          <Pressable
            key={`${provider}-${index}`}
            accessibilityRole="link"
            accessibilityLabel={provider}
            onPress={() => void Linking.openURL(providerUri).catch(() => {})}
            style={styles.creditLink}
          >
            <Text style={styles.attribution}>{provider}</Text>
          </Pressable>
        ) : (
          <Text key={`${provider}-${index}`} style={styles.attribution}>
            {provider}
          </Text>
        ),
      )}
    </View>
  );
}

function Check() {
  return <Ionicons name="checkmark-circle" size={20} color={colors.primary} accessible={false} />;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: MIN_TARGET,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.cardHi,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: MIN_TARGET,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  input: { ...type.body, flex: 1, color: colors.text, paddingVertical: space.sm },
  description: { flex: 1 },
  label: { ...type.body, fontFamily: fonts.semibold, color: colors.text },
  detail: { ...type.caption, color: colors.muted },
  credits: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  attribution: { ...type.caption, color: colors.primaryText },
  creditLink: { minHeight: MIN_TARGET, minWidth: MIN_TARGET, justifyContent: 'center' },
  pressed: { opacity: 0.7 },
});
