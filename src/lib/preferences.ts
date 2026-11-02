import {
  CATEGORY_OPTIONS,
  DISTANCE_OPTIONS,
  PRICE_OPTIONS,
  type Preferences,
} from '@shared/domain/preferences.ts';

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
