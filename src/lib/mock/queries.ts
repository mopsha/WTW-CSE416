import type { Queries } from '../queries';
import { MOCK_PLACES } from './fixtures';
import { mockPicks } from './store';

const delay = () => new Promise((r) => setTimeout(r, 200));

export const mockQueries: Queries = {
  async listMyPicks() {
    await delay();
    return [...mockPicks.values()].map((p) => ({ ...p.summary, state: p.outcome.state }));
  },
  async getCandidates(pickId) {
    await delay();
    if (!mockPicks.has(pickId)) return [];
    return MOCK_PLACES.map((p) => ({ ...p }));
  },
  async getMyPreferences(pickId) {
    await delay();
    const pick = mockPicks.get(pickId);
    return pick ? [...pick.myPreferences].map(([placeId, value]) => ({ placeId, value })) : [];
  },
  async getRankingResults(pickId) {
    await delay();
    return [...(mockPicks.get(pickId)?.ranking ?? [])];
  },
  async getPickOutcome(pickId) {
    await delay();
    const pick = mockPicks.get(pickId);
    return pick ? { ...pick.outcome } : null;
  },
};
