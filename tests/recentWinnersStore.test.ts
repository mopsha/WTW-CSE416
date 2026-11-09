import type { RecentWinnersStore } from '@shared/api/recentWinners.ts';
const { createRecentWinnersStore } = jest.requireActual<{
  createRecentWinnersStore(): RecentWinnersStore;
}>('../supabase/functions/api/recentWinnersStore.ts');
const mockResult = jest.fn();
const mockQuery = {
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  in: jest.fn().mockReturnThis(),
  then: (yes: (value: unknown) => unknown, no: (error: unknown) => unknown) =>
    mockResult().then(yes, no),
};
const mockFrom = jest.fn(() => mockQuery);
jest.mock('../supabase/functions/api/serviceClient', () => ({
  createServiceClient: () => ({ from: mockFrom }),
}));
beforeEach(() => jest.clearAllMocks());
test('batch winner query scopes membership and completed state, and joins the canonical composite winner', async () => {
  mockResult.mockResolvedValue({
    data: [
      {
        pick: {
          id: 'pick',
          winner_place_id: 'canonical',
          winner: { place_id: 'canonical', snapshot: { provider: 'google' } },
        },
      },
      { pick: { id: 'missing', winner_place_id: null, winner: null } },
      {
        pick: {
          id: 'wrong',
          winner_place_id: 'canonical',
          winner: { place_id: 'different', snapshot: {} },
        },
      },
    ],
    error: null,
  });
  expect(
    await createRecentWinnersStore().load('verified-user', ['pick', 'missing', 'wrong']),
  ).toEqual([{ pickId: 'pick', placeId: 'canonical', snapshot: { provider: 'google' } }]);
  expect(mockFrom).toHaveBeenCalledTimes(1);
  expect(mockFrom).toHaveBeenCalledWith('pick_participants');
  expect(mockQuery.eq).toHaveBeenCalledWith('user_id', 'verified-user');
  expect(mockQuery.eq).toHaveBeenCalledWith('pick.state', 'completed');
  expect(mockQuery.in).toHaveBeenCalledWith('pick_id', ['pick', 'missing', 'wrong']);
  expect(mockQuery.select).toHaveBeenCalledWith(
    expect.stringContaining('pick_candidates!picks_winner_is_candidate'),
  );
});
test('database errors fail closed before Google access', async () => {
  mockResult.mockResolvedValue({ data: null, error: { message: 'Private database error' } });
  await expect(createRecentWinnersStore().load('viewer', ['pick'])).rejects.toThrow(
    'Recent winners unavailable',
  );
});
