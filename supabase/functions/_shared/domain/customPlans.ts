import type { Candidate, Category } from '../places/types.ts';
import type { LatLng } from './geo.ts';

export interface CustomOption {
  name: string;
  note?: string;
  lat?: number;
  lng?: number;
}
export interface PlanOptions {
  includeSaved?: boolean;
  customOptions?: CustomOption[];
  mixCategory?: Category;
}
export interface StoredCustomOption extends Candidate {
  category: 'custom';
  provider: 'custom';
  createdBy: string;
  note?: string;
  locationProvided: boolean;
}

/** No teammate text filter exists in this checkout. This validates shape/length only. */
export function customOptionsProblem(value: unknown): string | null {
  if (!Array.isArray(value) || value.length < 2 || value.length > 20) return 'Enter 2–20 options.';
  for (const option of value) {
    if (!option || typeof option !== 'object' || Array.isArray(option))
      return 'Each option must be an object.';
    const { name, note, lat, lng } = option;
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 60)
      return 'Option names must be 1–60 characters.';
    if (note !== undefined && (typeof note !== 'string' || note.length > 200))
      return 'Notes must be at most 200 characters.';
    if (
      (lat === undefined) !== (lng === undefined) ||
      (lat !== undefined &&
        (typeof lat !== 'number' ||
          !Number.isFinite(lat) ||
          Math.abs(lat) > 90 ||
          typeof lng !== 'number' ||
          !Number.isFinite(lng) ||
          Math.abs(lng) > 180))
    )
      return 'Supply both valid coordinates, or neither.';
  }
  return null;
}

export function planProblem(body: Record<string, unknown>): string | null {
  if (body.includeSaved !== undefined && typeof body.includeSaved !== 'boolean')
    return 'includeSaved must be boolean.';
  if (
    body.mixCategory !== undefined &&
    body.mixCategory !== 'food' &&
    body.mixCategory !== 'activities'
  )
    return 'Choose food or activities to mix.';
  if (body.mixCategory !== undefined && body.category !== 'custom')
    return 'mixCategory requires a custom Pick.';
  if (body.category === 'custom' || body.customOptions !== undefined)
    return customOptionsProblem(body.customOptions);
  if (body.mixCategory !== undefined) return 'mixCategory requires custom options.';
  return null;
}

/** UUID generation is injected: Postgres generates production IDs; mock supplies its own UUIDs. */
export function makeCustomOptions(
  options: CustomOption[],
  createdBy: string,
  center: LatLng,
  uuid: () => string,
): StoredCustomOption[] {
  return options.map((option) => ({
    placeId: `custom:${uuid()}`,
    name: option.name.trim(),
    note: option.note,
    category: 'custom',
    provider: 'custom',
    source: 'custom',
    createdBy,
    retention: 'persistable',
    // Neutral ranking point for an option with no location. Display code hides it;
    // original user coordinates remain distinguishable through locationProvided.
    lat: option.lat ?? center.lat,
    lng: option.lng ?? center.lng,
    locationProvided: option.lat !== undefined && option.lng !== undefined,
  }));
}

export const CUSTOM_TEMPLATES = [
  'Game night',
  'Basketball',
  'Cookout',
  'Study session',
  'House party',
  'Movie night',
] as const;
