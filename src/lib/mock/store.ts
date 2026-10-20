// In-memory "backend" state for mock mode. Resets when the app reloads, or via resetMockData().
import type { CreatePickInput } from '@shared/domain/createPick.ts';

import type { PickOutcome, PickSummary, PreferenceValue, RankedPlace } from '../types';
import { MOCK_PICKS } from './fixtures';

export interface MockPick {
  summary: PickSummary;
  outcome: PickOutcome;
  /** My answers, by placeId. */
  myPreferences: Map<string, PreferenceValue>;
  ranking: RankedPlace[];
  /** What the host chose in Create Pick (fixture Picks have none). */
  settings: CreatePickInput | null;
  /** For newest-first ordering; fixtures are 0. */
  createdAt: number;
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
        settings: null,
        createdAt: 0,
      },
    ]),
  );
}

export const mockPicks: Map<string, MockPick> = initial();

export function resetMockData() {
  mockPicks.clear();
  for (const [id, pick] of initial()) mockPicks.set(id, pick);
}
