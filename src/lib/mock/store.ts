// In-memory "backend" state for mock mode. Resets when the app reloads, or via resetMockData().
import type { PickOutcome, PickSummary, PreferenceValue, RankedPlace } from '../types';
import { MOCK_PICKS } from './fixtures';

export interface MockPick {
  summary: PickSummary;
  outcome: PickOutcome;
  /** My answers, by placeId. */
  myPreferences: Map<string, PreferenceValue>;
  ranking: RankedPlace[];
}

function initial(): Map<string, MockPick> {
  return new Map(
    MOCK_PICKS.map(({ hostId, ...summary }) => [
      summary.id,
      {
        summary,
        outcome: { state: summary.state, hostId, winnerPlaceId: null, decidedBy: null },
        myPreferences: new Map(),
        ranking: [],
      },
    ]),
  );
}

export const mockPicks: Map<string, MockPick> = initial();

export function resetMockData() {
  mockPicks.clear();
  for (const [id, pick] of initial()) mockPicks.set(id, pick);
}
