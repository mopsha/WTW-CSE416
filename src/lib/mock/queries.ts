import type { Queries } from '../queries';
import { DEMO_PICK, DEMO_PICK_ID, MOCK_PLACES } from './fixtures';
import { mockState } from './store';

const delay = () => new Promise((r) => setTimeout(r, 200));

export const mockQueries: Queries = {
  async listMyPicks() {
    await delay();
    return [{ ...DEMO_PICK, state: mockState.outcome.state }];
  },
  async getCandidates(pickId) {
    await delay();
    if (pickId !== DEMO_PICK_ID) return [];
    return MOCK_PLACES.map(({ placeId, name, photoUrl, priceLevel, rating }) => ({
      placeId,
      name,
      photoUrl,
      priceLevel,
      rating,
    }));
  },
  async getMyPreferences(pickId) {
    await delay();
    if (pickId !== DEMO_PICK_ID) return [];
    return [...mockState.myPreferences].map(([placeId, value]) => ({ placeId, value }));
  },
  async getRankingResults(pickId) {
    await delay();
    return pickId === DEMO_PICK_ID ? [...mockState.ranking] : [];
  },
  async getPickOutcome(pickId) {
    await delay();
    return pickId === DEMO_PICK_ID ? { ...mockState.outcome } : null;
  },
};
