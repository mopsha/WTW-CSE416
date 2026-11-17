import {
  CATEGORY_OPTIONS,
  DISTANCE_OPTIONS,
  PRICE_OPTIONS,
  type Preferences,
} from '@shared/domain/preferences.ts';

const METERS_PER_MILE = 1609;
/** The new Pick location editor's slider maximum. */
const MAX_PICK_MILES = 10;

/**
 * New Pick form starting values from my answers: my one category (if I picked exactly one),
 * my budget and my distance. Anything unanswered keeps the form's own default (undefined).
 */
export function pickDefaults(p: Preferences): {
  category?: 'food' | 'activities';
  priceMax?: number;
  miles?: number;
} {
  return {
    category: p.categories.length === 1 ? p.categories[0] : undefined,
    priceMax: p.priceMax ?? undefined,
    miles: p.maxDistanceM
      ? Math.min(MAX_PICK_MILES, Math.round(p.maxDistanceM / METERS_PER_MILE))
      : undefined,
  };
}

const labelOf = <T>(options: readonly { value: T; label: string }[], value: T) =>
  options.find((o) => o.value === value)?.label;

/** One line for the Profile tab, e.g. "Food · 4 favorites · up to $$ · within 5 mi". */
export function preferencesSummary(p: Preferences): string {
  const parts = [
    p.categories.length === CATEGORY_OPTIONS.length
      ? 'Food and activities'
      : p.categories[0] === 'food'
        ? 'Food'
        : p.categories[0] === 'activities'
          ? 'Activities'
          : null,
    p.types.length ? `${p.types.length} favorite${p.types.length === 1 ? '' : 's'}` : null,
    p.priceMax ? `up to ${labelOf(PRICE_OPTIONS, p.priceMax)}` : null,
    p.maxDistanceM ? `within ${labelOf(DISTANCE_OPTIONS, p.maxDistanceM)}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Not set yet';
}
