// Onboarding's practice swipe: ~12 cards, each teaching one preference type. Real nearby places
// when we know where the user is (two Discover calls), offline type cards otherwise. Photos load
// one card ahead, like Discover, so skipping the deck doesn't pay for a dozen covers.
import type { Candidate as ApiCandidate } from '@shared/places/types.ts';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { api } from '@/lib/api';
import { photoSource, photoState, releasePhotos, type PhotoSource } from '@/lib/photoCache';
import { usePhotoRequests } from '@/hooks/usePhotoRequests';
import { useAuth } from '@/hooks/useAuth';
import { discoverPlace } from '@/lib/discoverFeed';
import { buildTasteDeck, tasteLabel, type TasteCard } from '@/lib/tasteDeck';
import type { Candidate, PreferenceValue } from '@/lib/types';

import { ActionBar } from './ActionBar';
import { ProgressBar } from './ProgressBar';
import { SwipeCard, type SwipeCardHandle } from './SwipeCard';
import { colors, space } from './theme';

type LatLng = { lat: number; lng: number };
export type TasteAnswer = { card: TasteCard<unknown>; value: PreferenceValue };
type Shown = TasteCard<unknown> & {
  view: Candidate;
  /** Google cover to load once the card is next up, with the photographers to credit. */
  photo?: { source: PhotoSource; credits: { provider: string; uri?: string }[] };
};

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

async function loadDeck(center: LatLng | null, owner: string): Promise<Shown[]> {
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
  return buildTasteDeck(food, activities).map((card) => {
    if (!card.place || !center || card.place.category === 'custom')
      return { ...card, view: typeCard(card) };
    const { photoName, photoCredits, ...view } = discoverPlace(card.place, center);
    return {
      ...card,
      // Answers keep preference identity, never provider photo metadata.
      place: { ...card.place, photos: undefined },
      view: { ...view, cuisine: tasteLabel(card.type) },
      ...(photoName
        ? { photo: { source: photoSource(photoName, owner), credits: photoCredits ?? [] } }
        : {}),
    };
  });
}

/** The card with its cover and the photographer credit Google requires, once loaded. */
function withPhoto(card: Shown, url: string | null | undefined): Candidate {
  if (!card.photo || !url) return card.view;
  return {
    ...card.view,
    photoUrl: url,
    attributions: [...(card.view.attributions ?? []), ...card.photo.credits],
  };
}

type TasteSwipeProps = {
  /** undefined while the caller is still finding out where the user is. */
  center: LatLng | null | undefined;
  onDone: (answers: TasteAnswer[]) => void;
};
export function TasteSwipe(props: TasteSwipeProps) {
  const { session } = useAuth();
  const owner = session?.user.id ?? '';
  return <TasteSwipeDeck key={owner} {...props} owner={owner} />;
}
function TasteSwipeDeck({ center, onDone, owner }: TasteSwipeProps & { owner: string }) {
  const [deck, setDeck] = useState<Shown[] | null>(null);
  const deckRef = useRef<Shown[] | null>(null);
  useLayoutEffect(() => {
    deckRef.current = deck;
  }, [deck]);
  const [answers, setAnswers] = useState<TasteAnswer[]>([]);
  const card = useRef<SwipeCardHandle>(null);
  // Cards answered so far, synchronously: a screen-reader action can answer a card twice.
  const answered = useRef(0);
  const [photoRefresh, setPhotoRefresh] = useState(0);
  const activePhotos =
    deck
      ?.slice(answers.length, answers.length + 2)
      .flatMap((next) => (next.photo ? [next.photo.source] : [])) ?? [];
  const photoVersion = usePhotoRequests(owner, activePhotos, () =>
    setPhotoRefresh((value) => value + 1),
  );
  useEffect(
    () => () =>
      releasePhotos(deck?.flatMap((next) => (next.photo ? [next.photo.source] : [])) ?? []),
    [deck],
  );

  useEffect(() => {
    if (center === undefined || !owner) return;
    let active = true;
    void loadDeck(center, owner)
      .catch(() => loadDeck(null, owner))
      .then((d) => {
        if (!active) {
          releasePhotos(d.flatMap((next) => (next.photo ? [next.photo.source] : [])));
          return;
        }
        const previous = deckRef.current;
        const next = !previous
          ? d
          : previous.map((old, index) => {
              if (index < answered.current) return { ...old, photo: undefined };
              const fresh = d.find(
                (item) => item.type === old.type && item.view.placeId === old.view.placeId,
              );
              return { ...old, photo: fresh ? fresh.photo : old.photo };
            });
        const used = new Set(next.flatMap((item) => (item.photo ? [item.photo.source] : [])));
        releasePhotos(
          d.flatMap((item) =>
            item.photo && !used.has(item.photo.source) ? [item.photo.source] : [],
          ),
        );
        setDeck(next);
      });
    return () => {
      active = false;
    };
  }, [center, owner, photoRefresh]);

  const current = deck?.[answers.length];
  const shown = useMemo(
    () =>
      current ? withPhoto(current, current.photo && photoState(current.photo.source).url) : null,
    // The external store revision invalidates the current image projection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [current, photoVersion],
  );
  if (!deck)
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} accessibilityLabel="Finding spots near you" />
      </View>
    );

  function answer(value: PreferenceValue) {
    if (!current || !deck || answered.current !== answers.length) return;
    if (current.photo) releasePhotos([current.photo.source]);
    answered.current += 1;
    const next = [...answers, { card: current, value }];
    setAnswers(next);
    if (next.length === deck.length) onDone(next);
  }

  return (
    <View style={styles.wrap}>
      <ProgressBar value={answers.length} total={deck.length} />
      <View style={styles.deck}>
        {current && shown ? (
          <SwipeCard key={current.type} ref={card} place={shown} onAnswer={answer} />
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
