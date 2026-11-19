import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { haptic } from '@/lib/haptics';
import {
  chosenLabel,
  currentLocation,
  searchLocations,
  type LocationResult,
} from '@/lib/locationSearch';
import type { LatLng } from '@shared/domain/geo.ts';

import { colors, fonts, MIN_TARGET, radius, space, type } from './theme';

interface Props {
  /** What the field shows once a place is chosen. */
  label: string;
  onPick: (center: LatLng, label: string) => void;
}

const DEBOUNCE_MS = 300;

/** Search box with suggestions plus "Use my location". */
export function LocationSearch({ label, onPick }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LocationResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Ignores answers to queries the user has already typed past.
  const latest = useRef(0);

  useEffect(() => {
    const id = ++latest.current;
    const generation = latest;
    const timer = setTimeout(() => {
      if (id !== latest.current) return;
      if (query.trim().length < 2) {
        setResults([]);
        return;
      }
      setSearching(true);
      const isCurrent = () => id === latest.current;
      // Results arrive through onUpdate only, so a late resolve can't put back unnamed hits.
      searchLocations(query, { isCurrent, onUpdate: setResults })
        .then((hits) => {
          if (id !== latest.current) return;
          setNote(hits.length === 0 ? 'No matches. Try another name or drop the pin.' : null);
        })
        .catch(() => {
          if (id === latest.current) setNote('Search isn’t available here. Drop the pin instead.');
        })
        .finally(() => {
          if (id === latest.current) setSearching(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ++generation.current;
    };
  }, [query]);

  const choose = (r: LocationResult) => {
    haptic.tap();
    ++latest.current;
    setLocating(false);
    setSearching(false);
    onPick(r.center, chosenLabel(r));
    setQuery('');
    setResults([]);
    setNote(null);
  };

  const useMine = () => {
    haptic.tap();
    const id = ++latest.current;
    setResults([]);
    setSearching(false);
    setLocating(true);
    setNote(null);
    currentLocation()
      .then((here) => {
        if (id !== latest.current) return;
        if (here) onPick(here, 'My location');
        else setNote('Location is off for WTW. Search or drop the pin instead.');
      })
      .catch(() => {
        if (id === latest.current) setNote('Couldn’t find you. Search or drop the pin instead.');
      })
      .finally(() => {
        if (id === latest.current) setLocating(false);
      });
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.field}>
        <Ionicons name="search" size={18} color={colors.muted} />
        <TextInput
          value={query}
          onChangeText={(value) => {
            ++latest.current;
            setLocating(false);
            setSearching(false);
            setResults([]);
            setQuery(value);
          }}
          placeholder={label || 'Search a place or area'}
          placeholderTextColor={label ? colors.text : colors.muted}
          style={styles.input}
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Search for where to meet"
          accessibilityHint={label ? `Currently ${label}` : undefined}
        />
        {searching ? <ActivityIndicator color={colors.muted} /> : null}
      </View>

      {results.map((r) => (
        <Pressable
          key={r.id}
          onPress={() => choose(r)}
          accessibilityRole="button"
          accessibilityLabel={`${r.label}, ${r.detail}`}
          style={({ pressed }) => [styles.result, pressed && styles.pressed]}
        >
          <Ionicons name="location-outline" size={18} color={colors.primary} />
          <View style={styles.resultText}>
            <Text style={styles.resultLabel}>{r.label}</Text>
            <Text style={styles.resultDetail}>{r.detail}</Text>
          </View>
        </Pressable>
      ))}

      {note ? <Text style={styles.note}>{note}</Text> : null}

      <Pressable
        onPress={useMine}
        disabled={locating}
        accessibilityRole="button"
        accessibilityLabel="Use my location"
        accessibilityState={{ busy: locating, disabled: locating }}
        style={({ pressed }) => [styles.mine, pressed && styles.pressed]}
      >
        {locating ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <Ionicons name="navigate" size={16} color={colors.primary} />
        )}
        <Text style={styles.mineText}>Use my location</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: MIN_TARGET + 4,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  input: { ...type.body, flex: 1, color: colors.text, paddingVertical: space.sm },
  result: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: MIN_TARGET,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    backgroundColor: colors.cardHi,
  },
  resultText: { flex: 1 },
  resultLabel: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
  resultDetail: { ...type.caption, color: colors.muted },
  note: { ...type.caption, color: colors.muted },
  mine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: MIN_TARGET,
    alignSelf: 'flex-start',
  },
  mineText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.primary },
  pressed: { opacity: 0.7 },
});
