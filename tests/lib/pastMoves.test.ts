import { attendanceDue, isPastMove, pastMoveWinner } from '@shared/domain/pastMoves.ts';
import { createApiClient } from '@/lib/api';
import {
  mockFetch,
  MOCK_API_BASE_URL,
  recordMockOutcome,
  resetMockPlanState,
} from '@/lib/mock/api';
import { MOCK_ACCESS_TOKEN, MOCK_USER_ID } from '@/lib/mock/auth';
import {
  mockPicks,
  mockBlocks,
  resetMockData,
  resetMockProfile,
  setMockBots,
} from '@/lib/mock/store';
import { resetMockFriends } from '@/lib/mock/friends';
import { mockUserProfiles, resetOwnMockUserProfile } from '@/lib/mock/userProfiles';
const api = createApiClient({
  baseUrl: MOCK_API_BASE_URL,
  getAccessToken: async () => MOCK_ACCESS_TOKEN,
  fetch: mockFetch,
});
const now = Date.parse('2026-11-03T12:00:00Z');
beforeEach(() => {
  setMockBots(false);
  resetMockData();
  resetMockPlanState();
  resetMockProfile();
  resetOwnMockUserProfile();
  resetMockFriends();
  mockBlocks.clear();
});
test('eligibility requires a completed Pick, explicit yes and the exact existing attendance time boundary', () => {
  expect(attendanceDue('2026-11-03T11:00:00Z', null, now)).toBe(true);
  expect(attendanceDue('2026-11-03T11:00:00.001Z', null, now)).toBe(false);
  expect(attendanceDue(null, '2026-11-03T09:00:00Z', now)).toBe(true);
  expect(attendanceDue(null, '2026-11-03T09:00:00.001Z', now)).toBe(false);
  for (const went of [false, undefined])
    expect(isPastMove('completed', null, '2026-11-01T12:00:00Z', went, now)).toBe(false);
  expect(isPastMove('swiping', null, '2026-11-01T12:00:00Z', true, now)).toBe(false);
  expect(isPastMove('completed', null, null, true, now)).toBe(false);
  expect(isPastMove('completed', null, '2026-11-01T12:00:00Z', true, now)).toBe(true);
});
test('owner attendance upserts produce one Past Move and corrections remove it without changing history', async () => {
  const before = await api.getHistory();
  expect((await api.getMyPastMoves()).pastMoves).toEqual([]);
  await api.recordOutcome('done-pick', true);
  await api.recordOutcome('done-pick', true, true);
  const moves = await api.getMyPastMoves();
  expect(moves.visible).toBe(true);
  expect(moves.pastMoves).toHaveLength(1);
  expect(moves.pastMoves[0]).toMatchObject({
    pickId: 'done-pick',
    participantCount: 4,
    attendedCount: 1,
  });
  expect((await api.getHistory()).picks).toHaveLength(before.picks.length);
  expect((await api.getPlan('done-pick')).myOutcome).toEqual({ went: true, again: true });
  await api.recordOutcome('done-pick', false);
  expect((await api.getMyPastMoves()).pastMoves).toEqual([]);
});
test('private/blocked/non-friend profiles and non-shared Picks never expose memories', async () => {
  const done = mockPicks.get('done-pick')!;
  // Fixture Pick's other IDs are not the social friends: explicitly use the accepted friend.
  done.participants[1]!.userId = 'mock-ava';
  recordMockOutcome(done.id, 'mock-ava', true);
  expect((await api.getUserPastMoves('mock-ava')).pastMoves).toHaveLength(1);
  mockUserProfiles.set('mock-ava', { ...mockUserProfiles.get('mock-ava')!, shareMetadata: false });
  expect(await api.getUserPastMoves('mock-ava')).toEqual({ visible: false, pastMoves: [] });
  mockUserProfiles.set('mock-ava', { ...mockUserProfiles.get('mock-ava')!, shareMetadata: true });
  done.participants = done.participants.filter((p) => p.userId !== MOCK_USER_ID);
  expect((await api.getUserPastMoves('mock-ava')).pastMoves).toEqual([]);
  mockBlocks.add('mock-ava');
  await expect(api.getUserPastMoves('mock-ava')).rejects.toMatchObject({ status: 404 });
  await expect(api.getUserPastMoves('mock-jordan')).rejects.toMatchObject({ status: 404 });
});
test('friend projection omits participant counts/names; Group Idea winners use frozen name/location', async () => {
  const p = mockPicks.get('done-pick')!;
  p.participants[1]!.userId = 'mock-ava';
  const winner = p.candidates.find((c) => c.placeId === p.winnerPlaceId)!;
  Object.assign(winner, {
    name: 'Catan at John’s',
    address: 'Original location',
    provider: 'custom',
    origin: 'group_idea',
  });
  recordMockOutcome(p.id, 'mock-ava', true);
  const move = (await api.getUserPastMoves('mock-ava')).pastMoves[0]!;
  expect(move.winner).toMatchObject({
    name: 'Catan at John’s',
    locationText: 'Original location',
    origin: 'group_idea',
  });
  expect(move.participantCount).toBeNull();
  expect(move.attendedCount).toBeNull();
  expect(move).not.toHaveProperty('participants');
});
test('legacy Google/request-scoped content is never rendered or hydrated', () => {
  expect(
    pastMoveWinner('google-id', {
      name: 'Restricted',
      address: 'Restricted address',
      provider: 'google',
    }),
  ).toMatchObject({ placeId: 'google-id', name: null, locationText: null });
  expect(
    pastMoveWinner('request-id', { name: 'Restricted', retention: 'request' }).name,
  ).toBeNull();
  expect(
    pastMoveWinner('fixture-id', { name: 'Historical place', address: 'Original address' }, 'mock'),
  ).toMatchObject({ name: 'Historical place', locationText: 'Original address' });
});
test('future plans stay out and account deletion clears own attendance', async () => {
  const p = mockPicks.get('done-pick')!;
  p.planAt = new Date(Date.now() + 86400000).toISOString();
  await api.recordOutcome(p.id, true);
  expect((await api.getMyPastMoves()).pastMoves).toEqual([]);
  resetMockPlanState();
  p.planAt = undefined;
  await api.recordOutcome(p.id, true);
  expect((await api.getMyPastMoves()).pastMoves).toHaveLength(1);
  await api.deleteMe();
  expect((await api.getMyPastMoves()).pastMoves).toEqual([]);
});
