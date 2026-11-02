// Discover (M3): one fixed list of real places around Stony Brook, the same for everyone, until
// a real Discover feed (FR-17, Josh, M4) comes from the places provider. Food is the 20 places
// the demo Pick uses (src/lib/mock/fixtures.ts, coordinates from OpenStreetMap); activities
// were looked up on OpenStreetMap (Nominatim) by name or street address on Oct 21, 2026.
// Price levels are the team's estimates; null = free or varies.
import { MOCK_PLACES } from './mock/fixtures';
import { CAMPUS } from './places';
import type { Candidate } from './types';

export type DiscoverCategory = 'food' | 'activities';
export type DiscoverFilter = 'all' | DiscoverCategory;

export interface DiscoverPlace extends Candidate {
  providerCredits?: string[];
  category: DiscoverCategory;
  /** e.g. "Vietnamese", "Beach". Same as `cuisine` (which the shared place UI reads). */
  kind: string;
  /** Shown on the card when there's no photo. */
  emoji: string;
  lat: number;
  lng: number;
  /** Miles from the SBU Academic Mall, for sorting and the card. */
  miles: number;
}

// [id, name, kind, emoji, address, priceLevel 1-4 | null, lat, lng]
type Row = [string, string, string, string, string, number | null, number, number];
const ACTIVITIES: readonly Row[] = [
  [
    'sbu-act-01',
    'Avalon Nature Preserve',
    'Nature walk',
    '🌿',
    '200 Harbor Rd, Stony Brook',
    null,
    40.9141456,
    -73.1481305,
  ],
  [
    'sbu-act-02',
    'Benner’s Farm',
    'Farm',
    '🐐',
    '56 Gnarled Hollow Rd, East Setauket',
    2,
    40.9358981,
    -73.1000308,
  ],
  [
    'sbu-act-03',
    'Caleb Smith State Park Preserve',
    'Hiking',
    '🥾',
    '581 W Jericho Tpke, Smithtown',
    1,
    40.8533936,
    -73.2280719,
  ],
  [
    'sbu-act-04',
    'Frank Melville Memorial Park',
    'Park',
    '🌳',
    '1 Old Field Rd, Setauket',
    null,
    40.9464376,
    -73.1155712,
  ],
  [
    'sbu-act-05',
    'Harborfront Park',
    'Waterfront park',
    '⚓',
    '101A E Broadway, Port Jefferson',
    null,
    40.9491324,
    -73.0675044,
  ],
  [
    'sbu-act-06',
    'Island Federal Arena',
    'Sports',
    '🏟️',
    'Stony Brook University',
    2,
    40.9174414,
    -73.1259796,
  ],
  [
    'sbu-act-07',
    'Kenneth P. LaValle Stadium',
    'Sports',
    '🏟️',
    'Stony Brook University',
    2,
    40.9187508,
    -73.1237019,
  ],
  [
    'sbu-act-08',
    'Old Field Point Lighthouse',
    'Lighthouse',
    '🗼',
    'Old Field Rd, Old Field',
    null,
    40.9769103,
    -73.1186039,
  ],
  [
    'sbu-act-09',
    'Port Jefferson Ferry',
    'Ferry ride',
    '⛴️',
    '102 W Broadway, Port Jefferson',
    3,
    40.9473456,
    -73.0698116,
  ],
  [
    'sbu-act-10',
    'Staller Center for the Arts',
    'Theater & film',
    '🎭',
    'Stony Brook University',
    2,
    40.9154816,
    -73.1211291,
  ],
  [
    'sbu-act-11',
    'Stony Brook Grist Mill',
    'Historic site',
    '🏛️',
    '100 Harbor Rd, Stony Brook',
    1,
    40.9149127,
    -73.1476671,
  ],
  [
    'sbu-act-12',
    'Stony Brook Village Center',
    'Shopping & strolling',
    '🛍️',
    '111 Main St, Stony Brook',
    null,
    40.9174239,
    -73.1473806,
  ],
  [
    'sbu-act-13',
    'Sunken Meadow State Park',
    'Beach & trails',
    '🌊',
    'Sunken Meadow Pkwy, Kings Park',
    1,
    40.9032528,
    -73.2591011,
  ],
  [
    'sbu-act-14',
    'Sweetbriar Nature Center',
    'Nature center',
    '🦉',
    '62 Eckernkamp Dr, Smithtown',
    1,
    40.8645873,
    -73.2047582,
  ],
  [
    'sbu-act-15',
    'Theatre Three',
    'Theater',
    '🎭',
    '412 Main St, Port Jefferson',
    3,
    40.9436585,
    -73.0675396,
  ],
  [
    'sbu-act-16',
    'West Meadow Beach',
    'Beach',
    '🏖️',
    'Trustees Rd, East Setauket',
    null,
    40.9432945,
    -73.1446489,
  ],
];

const FOOD_EMOJI: Record<string, string> = {
  Vietnamese: '🍜',
  'Bubble tea': '🧋',
  Mexican: '🌮',
  Italian: '🍝',
};

/** Great-circle miles between two points. */
export function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(toRad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(toRad(b.lng - a.lng) / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.sqrt(h));
}

const food: DiscoverPlace[] = MOCK_PLACES.map((p, i) => ({
  ...p,
  placeId: `sbu-food-${String(i + 1).padStart(2, '0')}`,
  category: 'food',
  kind: p.cuisine ?? 'Food',
  emoji: FOOD_EMOJI[p.cuisine ?? ''] ?? '🍽️',
  miles: milesBetween(CAMPUS, p),
}));

const activities: DiscoverPlace[] = ACTIVITIES.map(
  ([placeId, name, kind, emoji, address, priceLevel, lat, lng]) => ({
    placeId,
    name,
    photoUrl: null,
    priceLevel,
    rating: null,
    cuisine: kind,
    address,
    lat,
    lng,
    category: 'activities',
    kind,
    emoji,
    miles: milesBetween(CAMPUS, { lat, lng }),
  }),
);

/** Every Discover place, nearest first. The same list on every phone. */
export const DISCOVER_PLACES: readonly DiscoverPlace[] = [...food, ...activities].sort(
  (a, b) => a.miles - b.miles || a.name.localeCompare(b.name),
);

/** Filter by category and a search over name, kind and address; keeps nearest-first order. */
export function filterDiscover(
  places: readonly DiscoverPlace[],
  { category = 'all', query = '' }: { category?: DiscoverFilter; query?: string } = {},
): DiscoverPlace[] {
  const q = query.trim().toLowerCase();
  return places.filter(
    (p) =>
      (category === 'all' || p.category === category) &&
      (!q || [p.name, p.kind, p.address ?? ''].some((s) => s.toLowerCase().includes(q))),
  );
}

/** "0.6 mi" / "on campus". */
export function milesLabel(miles: number): string {
  return miles < 0.3 ? 'on campus' : `${miles.toFixed(1)} mi`;
}
