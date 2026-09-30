import type { PickState } from '@shared/domain/pickState.ts';

export type { PickState };

/** preferences.value: 0 = No, 1 = Maybe, 2 = Yes. */
export type PreferenceValue = 0 | 1 | 2;

export const PREFERENCE_LABEL: Readonly<Record<PreferenceValue, string>> = {
  0: 'No',
  1: 'Maybe',
  2: 'Yes',
};

export interface PickSummary {
  id: string;
  state: PickState;
  category: string;
  deadlineAt: string | null;
}

/** What the Swipe and Results screens show for a place. Built from pick_candidates.snapshot. */
export interface Candidate {
  placeId: string;
  name: string;
  photoUrl: string | null;
  /** 1–4 ($ to $$$$). */
  priceLevel: number | null;
  /** Provider star rating, 0–5. */
  rating: number | null;
  /** e.g. "Vietnamese". */
  cuisine: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
}

export interface MyPreference {
  placeId: string;
  value: PreferenceValue;
}

/** A row of ranking_results as the app may see it. Scores are never read or shown. */
export interface RankedPlace {
  placeId: string;
  rank: number;
  finalist: boolean;
}

export interface PickOutcome {
  state: PickState;
  /** Only the host may close swiping and rank (POST /picks/:id/rank returns 403 otherwise). */
  hostId: string;
  winnerPlaceId: string | null;
  decidedBy: 'clear_winner' | 'vote' | null;
}

/** A place's position in the ranking. The API never sends scores. */
export interface RankPosition {
  placeId: string;
  rank: number;
}

/** What POST /picks/:id/rank decided (see docs/api-integration.md). */
export type RankDecision =
  | { kind: 'winner'; winner: RankPosition }
  /** Top three, plus anyone tied with #1 beyond that. */
  | { kind: 'vote'; finalists: RankPosition[] };
