import { ApiError, errorResponse } from '@shared/api/errors.ts';
import type { PastMove, PastMovesResult } from '@shared/api/pastMoves.ts';
import { isPastMove, pastMoveWinner } from '@shared/domain/pastMoves.ts';
import { MOCK_USER_ID } from './auth';
import { mockGetGroup, mockGroupOfPick } from './groups';
import { mockPicks, type MockPick } from './store';
import { getMockUserProfile } from './userProfiles';
interface PlanState {
  planAt: string | null;
  outcomes: Map<string, { went: boolean; again: boolean | null; answeredAt?: string }>;
}
export function mockPastMoves(
  targetId: string,
  groupId: string | null,
  readPlan: (p: MockPick) => PlanState,
  now = Date.now(),
): PastMovesResult {
  const profile = getMockUserProfile(targetId); // Existing friendship/block and metadata privacy rules.
  if (!profile.metadataVisible) return { visible: false, pastMoves: [] };
  if (groupId && !mockGetGroup(groupId)) throw new ApiError(404, 'NOT_FOUND', 'Group not found');
  const own = targetId === MOCK_USER_ID;
  const pastMoves: PastMove[] = [];
  for (const pick of mockPicks.values()) {
    const plan = readPlan(pick);
    const answer = plan.outcomes.get(targetId);
    if (
      !pick.participants.some((p) => p.userId === targetId) ||
      !isPastMove(pick.state, plan.planAt, pick.decidedAt, answer?.went, now)
    )
      continue;
    if (!own && !pick.participants.some((p) => p.userId === MOCK_USER_ID)) continue;
    const group = mockGroupOfPick(pick.id);
    if (groupId && group !== groupId) continue;
    const winner = pick.candidates.find((c) => c.placeId === pick.winnerPlaceId);
    if (!winner) continue;
    const visibleGroup = group ? mockGetGroup(group) : null;
    pastMoves.push({
      pickId: pick.id,
      category: pick.category,
      occurredAt: plan.planAt ?? pick.decidedAt!,
      confirmedAt: own ? (answer!.answeredAt ?? pick.decidedAt!) : null,
      winner: pastMoveWinner(
        winner.placeId,
        winner as unknown as Record<string, unknown>,
        winner.provider,
      ),
      group: visibleGroup ? { id: visibleGroup.id, name: visibleGroup.name } : null,
      participantCount: own ? pick.participants.length : null,
      attendedCount: own ? [...plan.outcomes.values()].filter((a) => a.went).length : null,
    });
  }
  return {
    visible: true,
    pastMoves: pastMoves
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.pickId.localeCompare(b.pickId))
      .slice(0, 50),
  };
}
export function handleMockPastMoves(
  method: string,
  path: string,
  query: URLSearchParams,
  readPlan: (p: MockPick) => PlanState,
) {
  const match = /^\/users\/([^/]+)\/past-moves$/.exec(path);
  if (method !== 'GET' || (path !== '/me/past-moves' && !match)) return null;
  try {
    return {
      status: 200,
      body: mockPastMoves(
        match ? decodeURIComponent(match[1]!) : MOCK_USER_ID,
        query.get('groupId'),
        readPlan,
      ),
    };
  } catch (e) {
    return errorResponse(e);
  }
}
