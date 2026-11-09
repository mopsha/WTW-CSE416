import summaryQuery from '@shared/queries/pickSummaries.json';
import { queries } from '@/lib/queries';

const mockPageSelect = jest.fn();
const mockRpc = jest.fn((_name: string, _args: object) => ({ select: mockPageSelect }));
const mockEq = jest.fn();
const mockSelect = jest.fn(() => ({ eq: mockEq }));
const mockFrom = jest.fn(() => ({ select: mockSelect }));
jest.mock('@/lib/config', () => ({ USE_MOCK: false }));
jest.mock('@/lib/supabase', () => ({ getSupabase: () => ({ from: mockFrom, rpc: mockRpc }) }));
jest.mock('@/lib/mock/queries', () => ({ mockQueries: {} }));

beforeEach(() => jest.clearAllMocks());
test('member-scoped summaries left-embed the composite persisted winner and keep every record', async () => {
  const row = (id: string, state: string, winner: unknown) => ({
    id,
    state,
    category: 'custom',
    deadline_at: null,
    created_at: '2026-11-01T00:00:00Z',
    decided_at: null,
    winner,
  });
  mockEq.mockResolvedValue({
    data: [
      { picks: row('real', 'completed', { name: ' Actual custom option ' }) },
      { picks: row('missing', 'completed', null) },
      { picks: row('canceled', 'canceled', { name: 'Ignored' }) },
      { picks: null },
      { picks: Array.from({ length: 6 }, (_, n) => row(String(n), 'completed', { name: null })) },
    ],
    error: null,
  });
  const result = await queries.listMyPicks('viewer');
  expect(mockFrom).toHaveBeenCalledWith('pick_participants');
  expect(mockEq).toHaveBeenCalledWith('user_id', 'viewer');
  expect(mockSelect).toHaveBeenCalledWith(`picks(${summaryQuery.select})`);
  expect(result).toHaveLength(9);
  expect(result[0]).toMatchObject({
    winnerName: 'Actual custom option',
    createdAt: '2026-11-01T00:00:00Z',
  });
  expect(result[1]?.winnerName).toBeNull();
  expect(result[2]?.winnerName).toBeNull();
});
test('query errors propagate to the existing retry UI', async () => {
  mockEq.mockResolvedValue({ data: null, error: { message: 'Offline' } });
  await expect(queries.listMyPicks('viewer')).rejects.toThrow('Offline');
});

test('home fetches bounded history and all active pages with stable cursors, not join-row offsets', async () => {
  const row = (id: number) => ({
    id: String(id),
    state: 'draft',
    category: 'food',
    deadline_at: null,
    created_at: '2026-01-01T00:00:00Z',
    decided_at: null,
  });
  mockPageSelect.mockImplementation(() => {
    const args = mockRpc.mock.calls.at(-1) as unknown as [
      string,
      { p_history: boolean; p_before_id: string | null },
    ];
    if (args[1].p_history)
      return Promise.resolve({
        data: [{ ...row(2000), state: 'completed', winner: { name: 'Actual winner' } }],
        error: null,
      });
    const start = args[1].p_before_id ? Number(args[1].p_before_id) + 1 : 0;
    return Promise.resolve({
      data: Array.from({ length: Math.min(100, 1001 - start) }, (_, n) => row(start + n)),
      error: null,
    });
  });
  const result = await queries.listPicksHome('viewer');
  expect(result).toHaveLength(1002);
  expect(result.at(-1)?.winnerName).toBe('Actual winner');
  expect(mockRpc).toHaveBeenCalledWith(
    summaryQuery.rpc,
    expect.objectContaining({ p_history: true, p_limit: 5 }),
  );
  expect(mockRpc).toHaveBeenCalledWith(
    summaryQuery.rpc,
    expect.objectContaining({ p_before_id: '999', p_before_time: '2026-01-01T00:00:00Z' }),
  );
  expect(mockPageSelect).toHaveBeenCalledWith(summaryQuery.select);
});
test('empty home pages terminate and failed pages never return partial success', async () => {
  mockPageSelect.mockResolvedValue({ data: [], error: null });
  expect(await queries.listPicksHome('viewer')).toEqual([]);
  mockPageSelect.mockResolvedValue({ data: null, error: { message: 'Access changed' } });
  await expect(queries.listPicksHome('viewer')).rejects.toThrow('Access changed');
});

test('a Pick completing between active/history reads appears only once with its terminal winner', async () => {
  mockPageSelect.mockImplementation(() => {
    const args = mockRpc.mock.calls.at(-1)![1] as { p_history: boolean };
    const completed = args.p_history;
    return Promise.resolve({
      data: [
        {
          id: 'same',
          state: completed ? 'completed' : 'draft',
          category: 'food',
          deadline_at: null,
          winner: completed ? { name: 'Winner' } : null,
        },
      ],
      error: null,
    });
  });
  const picks = await queries.listPicksHome('viewer');
  expect(picks).toHaveLength(1);
  expect(picks[0]).toMatchObject({ state: 'completed', winnerName: 'Winner' });
});
