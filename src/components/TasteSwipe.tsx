// Onboarding's practice swipe: ~12 cards, each teaching one preference type. Real nearby places
// when we know where the user is (two Discover calls), offline type cards otherwise.
import type { Candidate as ApiCandidate } from '@shared/places/types.ts';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { api } from '@/lib/api';
import { discoverPlace } from '@/lib/discoverFeed';
import { buildTasteDeck, tasteLabel, type TasteCard } from '@/lib/tasteDeck';
import type { Candidate, PreferenceValue } from '@/lib/types';

import { ActionBar } from './ActionBar';
import { ProgressBar } from './ProgressBar';
import { SwipeCard, type SwipeCardHandle } from './SwipeCard';
import { colors, space } from './theme';

type LatLng = { lat: number; lng: number };
export type TasteAnswer = { card: TasteCard<unknown>; value: PreferenceValue };
type Shown = TasteCard<unknown> & { view: Candidate };

function typeCard(card: TasteCard<unknown>): Candidate {
  return {
    placeId: `taste:${card.type}`,
    name: tasteLabel(card.type),
    photoUrl: null,
    priceLevel: null,
    rating: null,
    cuisine: card.category === 'food' ? 'Food' : 'Activity',
    address: null,
    lat: null,
    lng: null,
  };
}

async function loadDeck(center: LatLng | null): Promise<Shown[]> {
  let food: ApiCandidate[] = [];
  let activities: ApiCandidate[] = [];
  if (center) {
    // Best effort: any failure just means more offline type cards.
    const load = (category: 'food' | 'activities') =>
      api
        .discover({ ...center, category })
        .then((r) => r.places)
        .catch(() => [] as ApiCandidate[]);
    [food, activities] = await Promise.all([load('food'), load('activities')]);
  }
  return buildTasteDeck(food, activities).map((card) => ({
    ...card,
    view:
      card.place && center && card.place.category !== 'custom'
        ? { ...discoverPlace(card.place, center), cuisine: tasteLabel(card.type) }
        : typeCard(card),
  }));
}

export function TasteSwipe({
  center,
  onDone,
}: {
  /** undefined while the caller is still finding out where the user is. */
  center: LatLng | null | undefined;
  onDone: (answers: TasteAnswer[]) => void;
}) {
  const [deck, setDeck] = useState<Shown[] | null>(null);
  const [answers, setAnswers] = useState<TasteAnswer[]>([]);
  const card = useRef<SwipeCardHandle>(null);
  // Cards answered so far, synchronously: a screen-reader action can answer a card twice.
  const answered = useRef(0);

  useEffect(() => {
    if (center === undefined) return;
    let active = true;
    void loadDeck(center)
      .catch(() => loadDeck(null))
      .then((d) => active && setDeck(d));
    return () => {
      active = false;
    };
  }, [center]);

  if (!deck)
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} accessibilityLabel="Finding spots near you" />
      </View>
    );

  const current = deck[answers.length];
  function answer(value: PreferenceValue) {
    if (!current || !deck || answered.current !== answers.length) return;
    answered.current += 1;
    const next = [...answers, { card: current, value }];
    setAnswers(next);
    if (next.length === deck.length) onDone(next);
  }

  return (
    <View style={styles.wrap}>
      <ProgressBar value={answers.length} total={deck.length} />
      <View style={styles.deck}>
        {current ? (
          <SwipeCard key={current.type} ref={card} place={current.view} onAnswer={answer} />
        ) : null}
      </View>
      {current ? (
        <ActionBar compact placeName={current.view.name} onAnswer={(v) => card.current?.fling(v)} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, gap: space.md },
  deck: { flex: 1, minHeight: 340 },
  loading: { flex: 1, minHeight: 340, alignItems: 'center', justifyContent: 'center' },
});
