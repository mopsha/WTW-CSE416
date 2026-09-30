// Local fixture for EXPO_PUBLIC_USE_MOCK=1: the same 20 real places, order and coordinates
// as supabase/seed.sql (keep them in sync). Price levels are our estimates; ratings stay null.
// Photos are openly licensed Wikimedia Commons images of each cuisine (not the venues);
// credits in docs/demo-photo-credits.md.
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

// [name, cuisine, address, priceLevel 1-4, lat, lng, photoUrl]
const RAW: readonly [string, string, string, number, number, number, string][] = [
  [
    'Súp Vietnamese Phở & Grill',
    'Vietnamese',
    '1113 N Country Rd, Stony Brook',
    2,
    40.9193847,
    -73.1297139,
    'https://thumb.wikimedia.org/wikipedia/commons/thumb/9/99/Ph%E1%BB%9F_b%C3%B2%2C_C%E1%BA%A7u_Gi%E1%BA%A5y%2C_H%C3%A0_N%E1%BB%99i.jpg/960px-Ph%E1%BB%9F_b%C3%B2%2C_C%E1%BA%A7u_Gi%E1%BA%A5y%2C_H%C3%A0_N%E1%BB%99i.jpg',
  ],
  [
    "DJ's Clam Shack",
    'Seafood shack',
    '1007 N Country Rd, Stony Brook',
    2,
    40.9233111,
    -73.126503,
    'https://thumb.wikimedia.org/wikipedia/commons/thumb/6/60/Lobster_Roll_at_the_Lobster_Claw%2C_Bar_Harbor.jpg/960px-Lobster_Roll_at_the_Lobster_Claw%2C_Bar_Harbor.jpg',
  ],
  [
    'Kung Fu Tea',
    'Bubble tea',
    '1009 Route 25A, Stony Brook',
    1,
    40.9225234,
    -73.1274348,
    'https://thumb.wikimedia.org/wikipedia/commons/thumb/4/40/Thai_Iced_Bubble_Tea_-_Sonoma_Pho_-_Stierch_-_2019.jpg/960px-Thai_Iced_Bubble_Tea_-_Sonoma_Pho_-_Stierch_-_2019.jpg',
  ],
  [
    "Sweet Mama's",
    'Diner & brunch',
    '121 Main St, Stony Brook',
    2,
    40.9174711,
    -73.146546,
    'https://thumb.wikimedia.org/wikipedia/commons/thumb/4/43/NY_breakfast_02.jpg/960px-NY_breakfast_02.jpg',
  ],
  [
    'Crazy Beans',
    'Café & brunch',
    '97 Main St, Stony Brook',
    2,
    40.917065,
    -73.1463017,
    'https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d6/Cappuccino_with_latte_art_on_Coffee_Right_in_Brno%2C_Brno-City_District.jpg/960px-Cappuccino_with_latte_art_on_Coffee_Right_in_Brno%2C_Brno-City_District.jpg',
  ],
  [
    'Schnitzels',
    'German gastropub',
    '77 Main St, Stony Brook',
    2,
    40.9163002,
    -73.1463856,
    'https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b9/Wiener_Schnitzel_at_restaurant_West_Side_Story.jpg/960px-Wiener_Schnitzel_at_restaurant_West_Side_Story.jpg',
  ],
  [
    'LUCA',
    'Modern Italian',
    '93 Main St, Stony Brook',
    3,
    40.917318,
    -73.147334,
    'https://thumb.wikimedia.org/wikipedia/commons/thumb/6/65/Pork_tagliatelle_pasta_dish_at_restaurant_in_Rome%2C_Italy.jpg/960px-Pork_tagliatelle_pasta_dish_at_restaurant_in_Rome%2C_Italy.jpg',
  ],
  [
    'Brew Cheese',
    'Cheese & sandwiches',
    '127 Main St, Stony Brook',
    2,
    40.9177021,
    -73.1464392,
    'https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d3/Grilled_cheese_sandwich_with_roasted_tomato_soup.jpg/960px-Grilled_cheese_sandwich_with_roasted_tomato_soup.jpg',
  ],
  [
    "Robinson's Tea Room",
    'Tea room',
    '97 Main St, Stony Brook',
    2,
    40.917065,
    -73.1463017,
    'https://thumb.wikimedia.org/wikipedia/commons/thumb/0/03/Devonshire_tea.jpg/960px-Devonshire_tea.jpg',
  ],
  [
    'Mirabelle Tavern (Three Village Inn)',
    'French bistro',
    '150 Main St, Stony Brook',
    3,
    40.9191835,
    -73.1482395,
    'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a3/Steak_frites_at_The_Bar_at_MacArthur_Place_in_Sonoma_-_Sarah_Stierch.jpg/960px-Steak_frites_at_The_Bar_at_MacArthur_Place_in_Sonoma_-_Sarah_Stierch.jpg',
  ],
  [
    'Country House',
    'Classic American',
    '1175 N Country Rd, Stony Brook',
    3,
    40.9126723,
    -73.142145,
    'https://thumb.wikimedia.org/wikipedia/commons/thumb/1/1b/Roasted_Chicken_Dinner_Plate%2C_Broccoli%2C_Demi_Glace.jpg/960px-Roasted_Chicken_Dinner_Plate%2C_Broccoli%2C_Demi_Glace.jpg',
  ],
  [
    'Bliss',
    'New American',
    '766 Route 25A, East Setauket',
    3,
    40.9267281,
    -73.1181114,
    'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ae/Risotto_de_gambas%2C_restaurant_Danieli_%28Vienne%2C_Autriche%29.jpg/960px-Risotto_de_gambas%2C_restaurant_Danieli_%28Vienne%2C_Autriche%29.jpg',
  ],
  [
    "Mario's Italian Restaurant",
    'Italian',
    '212 Main St, East Setauket',
    2,
    40.9423169,
    -73.1039015,
    'https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d4/Margherita_Originale.JPG/960px-Margherita_Originale.JPG',
  ],
  [
    'Toast Coffeehouse',
    'Brunch & coffee',
    '650 Route 112, Port Jefferson Station',
    2,
    40.9271254,
    -73.0501623,
    'https://thumb.wikimedia.org/wikipedia/commons/thumb/6/6c/Avocado_toast_with_sesame_seeds.jpg/960px-Avocado_toast_with_sesame_seeds.jpg',
  ],
  [
    'Tiger Lily Café',
    'Healthy café',
    '156 E Main St, Port Jefferson',
    1,
    40.9466112,
    -73.0670743,
    'https://thumb.wikimedia.org/wikipedia/commons/thumb/8/80/A%C3%A7a%C3%AD_na_tigela_-_Acai_bowl.jpg/960px-A%C3%A7a%C3%AD_na_tigela_-_Acai_bowl.jpg',
  ],
  [
    'Salsa Salsa',
    'Mexican',
    '142 Main St, Port Jefferson',
    1,
    40.9455179,
    -73.0683675,
    'https://thumb.wikimedia.org/wikipedia/commons/thumb/4/4e/Tacos_on_a_plate.jpg/960px-Tacos_on_a_plate.jpg',
  ],
  [
    'Prohibition Kitchen',
    'Gastropub',
    '115 Main St, Port Jefferson',
    2,
    40.9462443,
    -73.0687358,
    'https://thumb.wikimedia.org/wikipedia/commons/thumb/5/5a/Cheeseburger_with_fries_-_Massachusetts.jpg/960px-Cheeseburger_with_fries_-_Massachusetts.jpg',
  ],
  [
    'Pasta Pasta',
    'Italian',
    '234 E Main St, Port Jefferson',
    3,
    40.9455243,
    -73.0673115,
    'https://thumb.wikimedia.org/wikipedia/commons/thumb/9/93/Spaghetti_alla_Carbonara.jpg/960px-Spaghetti_alla_Carbonara.jpg',
  ],
  [
    'Ruvo',
    'Italian',
    '105 Wynn Ln, Port Jefferson',
    3,
    40.9442612,
    -73.0681948,
    'https://thumb.wikimedia.org/wikipedia/commons/thumb/4/47/Pasta%2C_Syburg.jpg/960px-Pasta%2C_Syburg.jpg',
  ],
  [
    'Wave Seafood Kitchen (Danfords)',
    'Seafood',
    '25 E Broadway, Port Jefferson',
    3,
    40.9477909,
    -73.0687261,
    'https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d7/Cousins_Maine_Lobster_-_SF_Bay_Area_-_June_2023_-_Sarah_Stierch_03.jpg/960px-Cousins_Maine_Lobster_-_SF_Bay_Area_-_June_2023_-_Sarah_Stierch_03.jpg',
  ],
];

export const MOCK_PLACES: readonly MockPlace[] = RAW.map(
  ([name, cuisine, address, priceLevel, lat, lng, photoUrl], i) => ({
    placeId: `mock-place-${String(i + 1).padStart(2, '0')}`,
    name,
    photoUrl,
    priceLevel,
    rating: null,
    cuisine,
    address,
    lat,
    lng,
  }),
);

/** Three other (pretend) participants' answers, one per place, deterministic so demos repeat. */
export const OTHER_PARTICIPANT_ANSWERS: readonly (readonly PreferenceValue[])[] = [
  [2, 2, 1, 0, 1, 2, 0, 2, 2, 1, 2, 0, 1, 1, 2, 1, 0, 1, 2, 1],
  [1, 2, 2, 1, 0, 2, 1, 2, 1, 0, 2, 1, 1, 0, 2, 2, 0, 1, 1, 2],
  [2, 1, 1, 0, 1, 2, 2, 1, 2, 1, 1, 0, 2, 1, 2, 1, 1, 0, 1, 1],
];
