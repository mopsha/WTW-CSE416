import { errorResponse } from '@shared/api/errors.ts';
import type { ClosingStore } from '@shared/api/closing.ts';
import type { VotingStore } from '@shared/api/voting.ts';

const mockRpc = jest.fn();
jest.mock('../supabase/functions/api/serviceClient.ts', () => ({
  createServiceClient: () => ({ rpc: mockRpc }),
}));
// Load the adapter with its Deno-only service client mocked, keeping app tsc separate.
const { createClosingStore } = jest.requireActual<{
  createClosingStore(): ClosingStore & VotingStore;
}>('../supabase/functions/api/closingStore.ts');

beforeEach(() => mockRpc.mockReset());

test('uses the SQL argument names for every closing operation', async () => {
  const store = createClosingStore();
  mockRpc.mockResolvedValue({ data: null, error: null });

  await store.loadForClose('pick');
  expect(mockRpc).toHaveBeenLastCalledWith('pick_load_for_close', { p_pick_id: 'pick' });

  const ranking = {
    rows: [{ place_id: 'a', rank: 1, score: 100, finalist: false }],
    state: 'completed' as const,
    winnerPlaceId: 'a',
    voteDeadlineAt: null,
  };
  await store.applyClose('pick', '7', 'host', 'host', ranking);
  expect(mockRpc).toHaveBeenLastCalledWith('pick_close_apply', {
    p_pick_id: 'pick',
    p_actor: 'host',
    p_actor_user_id: 'host',
    p_version: '7',
    p_ranking: ranking,
  });

  await store.applyClose('pick', '7', 'system', null, ranking);
  expect(mockRpc).toHaveBeenLastCalledWith('pick_close_apply', {
    p_pick_id: 'pick',
    p_actor: 'system',
    p_actor_user_id: null,
    p_version: '7',
    p_ranking: ranking,
  });
});

test('uses the SQL argument names for every voting operation', async () => {
  const store = createClosingStore();
  mockRpc.mockResolvedValue({ data: null, error: null });

  await store.loadForVote('pick');
  expect(mockRpc).toHaveBeenLastCalledWith('pick_load_for_vote', { p_pick_id: 'pick' });

  await store.castVote('pick', 'host', 'a');
  expect(mockRpc).toHaveBeenLastCalledWith('pick_cast_vote', {
    p_pick_id: 'pick',
    p_user_id: 'host',
    p_place_id: 'a',
  });

  await store.applyVoteClose('pick', 'a');
  expect(mockRpc).toHaveBeenLastCalledWith('pick_close_vote_apply', {
    p_pick_id: 'pick',
    p_winner_place_id: 'a',
  });
});

test.each([
  ['PT400', 400],
  ['PT403', 403],
  ['PT404', 404],
  ['PT409', 409],
  ['XX000', 500],
  ['PGRST202', 503],
])('maps database %s to safe HTTP %s errors', async (code, status) => {
  mockRpc.mockResolvedValue({ data: null, error: { code, message: 'secret DB details' } });
  try {
    await createClosingStore().loadForClose('pick');
    throw new Error('expected loadForClose to reject');
  } catch (error) {
    const response = errorResponse(error);
    expect(response.status).toBe(status);
    expect(JSON.stringify(response)).not.toContain('secret DB details');
  }
});
