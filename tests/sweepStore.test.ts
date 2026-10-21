import type { SweepStore } from '@shared/api/sweep.ts';

const mockQuery = {
  select: jest.fn(),
  eq: jest.fn(),
  lte: jest.fn(),
  order: jest.fn(),
  limit: jest.fn(),
  gt: jest.fn(),
  then: jest.fn(),
};
const mockFrom = jest.fn(() => mockQuery);
jest.mock('../supabase/functions/api/serviceClient.ts', () => ({
  createServiceClient: () => ({ from: mockFrom }),
}));
const { createSweepStore } = jest.requireActual<{ createSweepStore(): SweepStore }>(
  '../supabase/functions/api/sweepStore.ts',
);
beforeEach(() => {
  jest.clearAllMocks();
  for (const name of ['select', 'eq', 'lte', 'order', 'limit', 'gt'] as const) {
    mockQuery[name].mockReturnValue(mockQuery);
  }
  mockQuery.then.mockImplementation((resolve) => resolve({ data: [{ id: 'p' }], error: null }));
});

test.each([
  ['swiping', 'deadline_at'],
  ['final_vote', 'vote_deadline_at'],
] as const)(
  'queries only expired %s rows with the correct deadline and cursor',
  async (phase, column) => {
    const cutoff = '2026-10-19T12:00:00Z';
    expect(await createSweepStore().expiredPage(phase, cutoff, 'previous')).toEqual([{ id: 'p' }]);
    expect(mockFrom).toHaveBeenCalledWith('picks');
    expect(mockQuery.select).toHaveBeenCalledWith('id');
    expect(mockQuery.eq).toHaveBeenCalledWith('state', phase);
    expect(mockQuery.lte).toHaveBeenCalledWith(column, cutoff);
    expect(mockQuery.order).toHaveBeenCalledWith('id', { ascending: true });
    expect(mockQuery.limit).toHaveBeenCalledWith(100);
    expect(mockQuery.gt).toHaveBeenCalledWith('id', 'previous');
  },
);

test('first page has no cursor and query errors do not leak database details', async () => {
  mockQuery.then.mockImplementation((resolve) =>
    resolve({ data: null, error: { message: 'private details' } }),
  );
  await expect(createSweepStore().expiredPage('swiping', '2026-10-19T12:00:00Z')).rejects.toThrow(
    'Sweep query failed',
  );
  expect(mockQuery.gt).not.toHaveBeenCalled();
});
