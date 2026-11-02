import type { PlaceFilters } from '@shared/domain/placeFilters.ts';
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
  /** From cached opening hours at reveal (Josh's isOpenAt); absent when unknown. */
  openNow?: boolean | null;
  /** ISO time it closes today, when known. */
  closesAt?: string | null;
  note?: string | null;
  provider?: 'mock' | 'google' | 'custom';
  createdBy?: string;
  locationProvided?: boolean;
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
  /**
   * Only the host may close swiping and rank (POST /picks/:id/rank returns 403 otherwise).
   * Null once the host deleted their account (shown as "Deleted user").
   */
  hostId: string | null;
  winnerPlaceId: string | null;
  decidedBy: DecidedBy | null;
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

/** How a Pick was decided. `tie_break` is set when a tied final vote fell to the tie-break chain. */
export type DecidedBy = 'clear_winner' | 'vote' | 'tie_break';

/** GET /picks/:id (Alan's lifecycle route): the Pick, MY candidate order and MY answers. */
export interface PickDetail extends PlaceFilters {
  id: string;
  state: PickState;
  category: 'food' | 'activities' | 'custom';
  center: { lat: number; lng: number };
  radiusM: number;
  poolSize: number;
  deadlineAt: string | null;
  closeThreshold: number;
  isHost: boolean;
  /** The host deleted their account. Optional: older backends don't send it. */
  hostDeleted?: boolean;
  participantCount: number;
  /** Already in this caller's per-person shuffle order. */
  candidates: Candidate[];
  /** placeId -> my answer. Only ever mine. */
  myAnswers: Record<string, PreferenceValue>;
  winnerPlaceId: string | null;
  decidedAt: string | null;
  decidedBy: DecidedBy | null;
}

/** One person in GET /picks/:id/progress. Says whether they're done, never what they answered. */
export interface ParticipantProgress {
  userId: string;
  displayName: string;
  isHost: boolean;
  isMe: boolean;
  /** Answered every candidate. */
  done: boolean;
  /** Has a ballot in the final vote (not which one). */
  voted: boolean;
}

/** GET /picks/:id/progress: counts only, safe to show everyone in the Pick. */
export interface PickProgress {
  state: PickState;
  deadlineAt: string | null;
  participants: ParticipantProgress[];
  doneCount: number;
  votedCount: number;
  total: number;
  /** The host deleted their account. Optional: older backends don't send it. */
  hostDeleted?: boolean;
}
