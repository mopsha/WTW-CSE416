import {
  castVote,
  closeVote,
  closeVoteByDeadline,
  tallyVotes,
  type VoteSnapshot,
  type VotingStore,
} from '@shared/api/voting.ts';

describe('tallyVotes', () => {
  const finalists = [
    { placeId: 'a', rank: 1 },
    { placeId: 'b', rank: 2 },
    { placeId: 'c', rank: 3 },
  ];
  const ballots = (...ids: string[]) => ids.map((placeId) => ({ placeId }));
  test('a clear majority is decided by the vote', () => {
    expect(tallyVotes(finalists, ballots('c', 'c', 'a'))).toEqual({ winnerPlaceId: 'c', decidedBy: 'vote' });
  });
  test('a tied top count goes to the better rank and is recorded as a tie-break', () => {
    expect(tallyVotes(finalists, ballots('c', 'b', 'b', 'c'))).toEqual({
      winnerPlaceId: 'b',
      decidedBy: 'tie_break',
    });
  });
  test('a tie below the top does not count as a tie-break', () => {
    expect(tallyVotes(finalists, ballots('a', 'a', 'b', 'c'))).toEqual({ winnerPlaceId: 'a', decidedBy: 'vote' });
  });
});

const snapshot = (overrides: Partial<VoteSnapshot> = {}): VoteSnapshot => ({
  id: 'pick',
  hostId: 'host',
  state: 'final_vote',
  participantIds: ['host', 'guest', 'third'],
  finalists: [
    { placeId: 'a', rank: 1 },
    { placeId: 'b', rank: 2 },
    { placeId: 'c', rank: 3 },
  ],
  ballots: [],
  voteDeadlineAt: '2026-10-19T12:30:00.000Z',
  ...overrides,
});
const beforeDeadline = new Date('2026-10-19T12:00:00.000Z');
const afterDeadline = new Date('2026-10-19T12:30:00.000Z');

function fixture(pick: VoteSnapshot | null = snapshot()) {
  return {
    loadForVote: jest.fn().mockResolvedValue(pick),
    castVote: jest.fn().mockResolvedValue(undefined),
    applyVoteClose: jest.fn().mockResolvedValue(undefined),
  } satisfies VotingStore;
}

describe('castVote', () => {
  test('rejects a vote for a non-finalist', async () => {
    const store = fixture();
    await expect(castVote(store, 'pick', 'host', { placeId: 'z' })).rejects.toMatchObject({
      status: 400,
    });
    expect(store.castVote).not.toHaveBeenCalled();
  });
  test('rejects a non-participant', async () => {
    const store = fixture();
    await expect(castVote(store, 'pick', 'outsider', { placeId: 'a' })).rejects.toMatchObject({
      status: 403,
    });
  });
  test('rejects voting outside final_vote', async () => {
    const store = fixture(snapshot({ state: 'swiping' }));
    await expect(castVote(store, 'pick', 'host', { placeId: 'a' })).rejects.toMatchObject({
      status: 409,
    });
  });
  test('records the ballot and settles once everyone has voted', async () => {
    const store = fixture();
    store.loadForVote
      .mockResolvedValueOnce(
        snapshot({ ballots: [{ userId: 'host', placeId: 'a' }, { userId: 'guest', placeId: 'b' }] }),
      )
      .mockResolvedValueOnce(
        snapshot({
          ballots: [
            { userId: 'host', placeId: 'a' },
            { userId: 'guest', placeId: 'b' },
            { userId: 'third', placeId: 'b' },
          ],
        }),
      );
    await castVote(store, 'pick', 'third', { placeId: 'b' });
    expect(store.castVote).toHaveBeenCalledWith('pick', 'third', 'b');
    expect(store.applyVoteClose).toHaveBeenCalledWith('pick', 'b', 'vote');
  });
  test('does not settle while ballots are still outstanding', async () => {
    const store = fixture();
    store.loadForVote
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce(snapshot({ ballots: [{ userId: 'host', placeId: 'a' }] }));
    await castVote(store, 'pick', 'host', { placeId: 'a' });
    expect(store.applyVoteClose).not.toHaveBeenCalled();
  });
});

describe('closeVote', () => {
  test('only the host can force a tally', async () => {
    const store = fixture();
    await expect(closeVote(store, 'pick', 'guest')).rejects.toMatchObject({ status: 403 });
    expect(store.applyVoteClose).not.toHaveBeenCalled();
  });
  test('tallies whatever ballots exist, most votes winning', async () => {
    const store = fixture(snapshot({ ballots: [{ userId: 'host', placeId: 'b' }] }));
    await closeVote(store, 'pick', 'host');
    expect(store.applyVoteClose).toHaveBeenCalledWith('pick', 'b', 'vote');
  });
  test('no ballots at all: the top-ranked finalist wins', async () => {
    const store = fixture(snapshot({ ballots: [] }));
    await closeVote(store, 'pick', 'host');
    // Every finalist tied at zero votes: rank order decided it.
    expect(store.applyVoteClose).toHaveBeenCalledWith('pick', 'a', 'tie_break');
  });
  test('is idempotent once already completed', async () => {
    const store = fixture(snapshot({ state: 'completed' }));
    await expect(closeVote(store, 'pick', 'host')).resolves.toEqual({ status: 'ok' });
    expect(store.applyVoteClose).not.toHaveBeenCalled();
  });
});

describe('closeVoteByDeadline', () => {
  test('settles a Pick in final_vote once its vote deadline has passed', async () => {
    const store = fixture(snapshot({ ballots: [{ userId: 'host', placeId: 'c' }] }));
    await closeVoteByDeadline(store, 'pick', afterDeadline);
    expect(store.applyVoteClose).toHaveBeenCalledWith('pick', 'c', 'vote');
  });
  test('is a no-op before the vote deadline, even if the swipe deadline is long gone', async () => {
    const store = fixture(snapshot({ ballots: [{ userId: 'host', placeId: 'c' }] }));
    await closeVoteByDeadline(store, 'pick', beforeDeadline);
    expect(store.applyVoteClose).not.toHaveBeenCalled();
  });
  test('is a no-op when no vote deadline was recorded', async () => {
    const store = fixture(snapshot({ voteDeadlineAt: null }));
    await closeVoteByDeadline(store, 'pick', afterDeadline);
    expect(store.applyVoteClose).not.toHaveBeenCalled();
  });
  test('does nothing for a missing or already-settled Pick', async () => {
    const store = fixture(null);
    await closeVoteByDeadline(store, 'pick', afterDeadline);
    expect(store.applyVoteClose).not.toHaveBeenCalled();

    const settled = fixture(snapshot({ state: 'completed' }));
    await closeVoteByDeadline(settled, 'pick', afterDeadline);
    expect(settled.applyVoteClose).not.toHaveBeenCalled();
  });
});
