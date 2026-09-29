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

// Same 20 real places, order and coordinates as supabase/seed.sql (keep them in sync).
// Price levels are our estimates; ratings stay null until the Google Places provider;
// photos are stock placeholders. [name, priceLevel 1-4, lat, lng]
const RAW: readonly [string, number, number, number][] = [
  ['Súp Vietnamese Phở & Grill', 2, 40.9193847, -73.1297139],
  ["DJ's Clam Shack", 2, 40.9233111, -73.126503],
  ['Kung Fu Tea', 1, 40.9225234, -73.1274348],
  ["Sweet Mama's", 2, 40.9174711, -73.146546],
  ['Crazy Beans', 2, 40.917065, -73.1463017],
  ['Schnitzels', 2, 40.9163002, -73.1463856],
  ['LUCA', 3, 40.917318, -73.147334],
  ['Brew Cheese', 2, 40.9177021, -73.1464392],
  ["Robinson's Tea Room", 2, 40.917065, -73.1463017],
  ['Mirabelle Tavern (Three Village Inn)', 3, 40.9191835, -73.1482395],
  ['Country House', 3, 40.9126723, -73.142145],
  ['Bliss', 3, 40.9267281, -73.1181114],
  ["Mario's Italian Restaurant", 2, 40.9423169, -73.1039015],
  ['Toast Coffeehouse', 2, 40.9271254, -73.0501623],
  ['Tiger Lily Café', 1, 40.9466112, -73.0670743],
  ['Salsa Salsa', 1, 40.9455179, -73.0683675],
  ['Prohibition Kitchen', 2, 40.9462443, -73.0687358],
  ['Pasta Pasta', 3, 40.9455243, -73.0673115],
  ['Ruvo', 3, 40.9442612, -73.0681948],
  ['Wave Seafood Kitchen (Danfords)', 3, 40.9477909, -73.0687261],
];

export const MOCK_PLACES: readonly MockPlace[] = RAW.map(([name, priceLevel, lat, lng], i) => {
  const n = String(i + 1).padStart(2, '0');
  return {
    placeId: `mock-place-${n}`,
    name,
    photoUrl: photo(n),
    priceLevel,
    rating: null,
    lat,
    lng,
  };
});

/** Three other (pretend) participants' answers, one per place, deterministic so demos repeat. */
export const OTHER_PARTICIPANT_ANSWERS: readonly (readonly PreferenceValue[])[] = [
  [2, 2, 1, 0, 1, 2, 0, 2, 2, 1, 2, 0, 1, 1, 2, 1, 0, 1, 2, 1],
  [1, 2, 2, 1, 0, 2, 1, 2, 1, 0, 2, 1, 1, 0, 2, 2, 0, 1, 1, 2],
  [2, 1, 1, 0, 1, 2, 2, 1, 2, 1, 1, 0, 2, 1, 2, 1, 1, 0, 1, 1],
];
