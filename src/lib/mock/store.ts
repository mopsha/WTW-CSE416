// In-memory "backend" state for mock mode. Resets when the app reloads, or via resetMockData().
import type { PickOutcome, PreferenceValue, RankedPlace } from '../types';
import { DEMO_PICK } from './fixtures';

interface MockState {
  outcome: PickOutcome;
  /** My answers for the demo Pick, by placeId. */
  myPreferences: Map<string, PreferenceValue>;
  ranking: RankedPlace[];
}

function initial(): MockState {
  return {
    outcome: { state: DEMO_PICK.state, winnerPlaceId: null, decidedBy: null },
    myPreferences: new Map(),
    ranking: [],
  };
}

export const mockState: MockState = initial();

export function resetMockData() {
  Object.assign(mockState, initial());
}
