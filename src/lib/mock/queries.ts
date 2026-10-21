import type { Queries } from '../queries';
import { MOCK_USER_ID } from './auth';
import { mockPicks, mockProfile, outcomeOf, summaryOf } from './store';

const delay = () =>
  process.env.NODE_ENV === 'test' ? Promise.resolve() : new Promise((r) => setTimeout(r, 200));

// RLS in mock form: only Picks I'm in, and only my own answers and ballot.
const mine = (pickId: string) => {
  const pick = mockPicks.get(pickId);
  return pick?.participants.some((p) => p.userId === MOCK_USER_ID) ? pick : undefined;
};

export const mockQueries: Queries = {
  async getMyProfile() {
    await delay();
    return { displayName: mockProfile.displayName };
  },
  async listMyPicks() {
    await delay();
    return [...mockPicks.values()]
      .filter((p) => mine(p.id))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(summaryOf);
  },
  async getMyPreferences(pickId) {
    await delay();
    const me = mine(pickId)?.participants.find((p) => p.userId === MOCK_USER_ID);
    return me ? [...me.answers].map(([placeId, value]) => ({ placeId, value })) : [];
  },
  async getRankingResults(pickId) {
    await delay();
    const pick = mine(pickId);
    // Like RLS + the API: nothing before the Pick leaves swiping.
    if (!pick || pick.state === 'draft' || pick.state === 'swiping') return [];
    return pick.ranking.map((r) => ({ ...r }));
  },
  async getPickOutcome(pickId) {
    await delay();
    const pick = mine(pickId);
    return pick ? outcomeOf(pick) : null;
  },
  async getMyVote(pickId) {
    await delay();
    return mine(pickId)?.participants.find((p) => p.userId === MOCK_USER_ID)?.vote ?? null;
  },
  async getJoinCode(pickId) {
    await delay();
    const pick = mine(pickId);
    return pick ? { code: pick.joinCode, expiresAt: null } : null;
  },
};
