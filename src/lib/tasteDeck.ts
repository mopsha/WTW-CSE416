// The onboarding practice swipe: a small deck where every card stands for one preference type,
// so each Yes/No teaches exactly one thing. Spec: docs/taste-onboarding.md.
import {
  ACTIVITY_TYPE_OPTIONS,
  FOOD_TYPE_OPTIONS,
  type PreferenceCategory,
  type Preferences,
} from '@shared/domain/preferences.ts';

import type { PreferenceValue } from './types';

export const TASTE_PER_CATEGORY = 6;

export interface TasteCard<P> {
  /** The one preference type this card teaches. */
  type: string;
  category: PreferenceCategory;
  /** A real nearby place, or null for the offline type card. */
  place: P | null;
}

const FOOD = FOOD_TYPE_OPTIONS.map((o) => o.value);
const ACTIVITIES = ACTIVITY_TYPE_OPTIONS.map((o) => o.value);

/** Fallback when location is off or nothing is nearby: spread across popular types. */
const FALLBACK: Record<PreferenceCategory, string[]> = {
  food: [
    'pizza_restaurant',
    'sushi_restaurant',
    'hamburger_restaurant',
    'mexican_restaurant',
    'ramen_restaurant',
    'cafe',
  ],
  activities: [
    'bowling_alley',
    'movie_theater',
    'miniature_golf_course',
    'park',
    'museum',
    'performing_arts_theater',
  ],
};

/**
 * One card per distinct type, in feed order: a place teaches its first own type (Google's order)
 * that is a survey type no earlier card already took. Missing slots are filled with offline type cards so the deck is
 * always TASTE_PER_CATEGORY food + TASTE_PER_CATEGORY activities, alternating.
 */
export function buildTasteDeck<P extends { types?: readonly string[] }>(
  food: readonly P[],
  activities: readonly P[],
): TasteCard<P>[] {
  const pick = (places: readonly P[], category: PreferenceCategory, allowed: string[]) => {
    const used = new Set<string>();
    const cards: TasteCard<P>[] = [];
    for (const place of places) {
      if (cards.length === TASTE_PER_CATEGORY) break;
      // Google lists the primary type first, so the card teaches what the place mainly is.
      const type = place.types?.find((t) => allowed.includes(t) && !used.has(t));
      if (!type) continue;
      used.add(type);
      cards.push({ type, category, place });
    }
    for (const type of FALLBACK[category]) {
      if (cards.length === TASTE_PER_CATEGORY) break;
      if (used.has(type)) continue;
      used.add(type);
      cards.push({ type, category, place: null });
    }
    return cards;
  };
  const f = pick(food, 'food', FOOD);
  const a = pick(activities, 'activities', ACTIVITIES);
  return f.flatMap((card, i) => (a[i] ? [card, a[i]] : [card]));
}

/**
 * Practice answers on top of what's already saved: Yes likes a type (and its category),
 * No skips it, Maybe leaves it alone. Liked and skipped never overlap.
 */
export function preferencesFromSwipes(
  base: Preferences,
  answers: readonly {
    card: Pick<TasteCard<unknown>, 'type' | 'category'>;
    value: PreferenceValue;
  }[],
): Preferences {
  const types = new Set(base.types);
  const disliked = new Set(base.dislikedTypes);
  const categories = new Set(base.categories);
  for (const { card, value } of answers) {
    if (value === 2) {
      types.add(card.type);
      disliked.delete(card.type);
      categories.add(card.category);
    } else if (value === 0) {
      disliked.add(card.type);
      types.delete(card.type);
    }
  }
  return {
    ...base,
    categories: (['food', 'activities'] as const).filter((c) => categories.has(c)),
    types: [...types],
    dislikedTypes: [...disliked],
  };
}

/** Survey label for a type, e.g. "Sushi". */
export function tasteLabel(type: string): string {
  return (
    [...FOOD_TYPE_OPTIONS, ...ACTIVITY_TYPE_OPTIONS].find((o) => o.value === type)?.label ?? type
  );
}
