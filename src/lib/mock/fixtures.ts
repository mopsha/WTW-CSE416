// Local fixture for EXPO_PUBLIC_USE_MOCK=1. Fictional places around Stony Brook.
import type { Candidate, PickSummary, PreferenceValue } from '../types';
import { MOCK_USER_ID } from './auth';

export interface MockPlace extends Candidate {
  lat: number;
  lng: number;
}

export const DEMO_CENTER = { lat: 40.9126, lng: -73.1234 }; // SBU Academic Mall
export const MOCK_FRIEND_ID = 'mock-friend';

/** Two Picks over the same 20 places: one I host (I can rank), one a friend hosts (I wait). */
export const MOCK_PICKS: readonly (PickSummary & { hostId: string })[] = [
  { id: 'demo-pick', state: 'swiping', category: 'food', deadlineAt: null, hostId: MOCK_USER_ID },
  {
    id: 'friend-pick',
    state: 'swiping',
    category: 'activities',
    deadlineAt: null,
    hostId: MOCK_FRIEND_ID,
  },
];

const photo = (seed: string) => `https://picsum.photos/seed/wtw-${seed}/800/600`;

// [name, priceLevel 1-4, rating 0-5, lat offset, lng offset]
const RAW: readonly [string, number, number, number, number][] = [
  ['Seawolf Noodle Bar', 1, 4.4, 0.002, 0.001],
  ['Harbor Taqueria', 1, 4.6, 0.011, -0.004],
  ['Setauket Slice', 1, 4.2, 0.018, 0.006],
  ['Old Field Oyster House', 3, 4.7, 0.031, -0.012],
  ['Nicolls Road Diner', 2, 4.0, -0.006, 0.009],
  ['Port Jeff Ramen Co.', 2, 4.5, 0.038, 0.021],
  ['Stony Brook Sushi Lab', 3, 4.3, 0.004, -0.008],
  ['Three Village Thai', 2, 4.6, 0.014, 0.014],
  ['Mill Pond Bakery', 1, 4.8, 0.009, -0.019],
  ['Long Island Smokehouse', 2, 4.1, -0.021, 0.017],
  ['Campus Falafel Cart', 1, 4.5, 0.001, 0.002],
  ['Brookhaven Burger Joint', 2, 3.9, -0.013, -0.006],
  ['Wading River Wood-Fired', 3, 4.4, 0.027, 0.03],
  ['Sound Beach Poke', 2, 4.2, 0.022, -0.027],
  ['Route 25A Dumplings', 1, 4.7, 0.016, 0.003],
  ['Centereach Curry House', 2, 4.3, -0.024, 0.004],
  ['Belle Terre Bistro', 4, 4.6, 0.041, 0.015],
  ['Shoreline Creperie', 2, 4.0, 0.035, -0.02],
  ['Lake Grove Korean BBQ', 3, 4.5, -0.03, -0.015],
  ['Night Owl Bagels', 1, 4.1, 0.006, 0.012],
];

export const MOCK_PLACES: readonly MockPlace[] = RAW.map(
  ([name, priceLevel, rating, dLat, dLng], i) => {
    const n = String(i + 1).padStart(2, '0');
    return {
      placeId: `mock-place-${n}`,
      name,
      photoUrl: photo(n),
      priceLevel,
      rating,
      lat: DEMO_CENTER.lat + dLat,
      lng: DEMO_CENTER.lng + dLng,
    };
  },
);

/** Three other (pretend) participants' answers, one per place, deterministic so demos repeat. */
export const OTHER_PARTICIPANT_ANSWERS: readonly (readonly PreferenceValue[])[] = [
  [2, 2, 1, 0, 1, 2, 0, 2, 2, 1, 2, 0, 1, 1, 2, 1, 0, 1, 2, 1],
  [1, 2, 2, 1, 0, 2, 1, 2, 1, 0, 2, 1, 1, 0, 2, 2, 0, 1, 1, 2],
  [2, 1, 1, 0, 1, 2, 2, 1, 2, 1, 1, 0, 2, 1, 2, 1, 1, 0, 1, 1],
];
