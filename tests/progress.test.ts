import { ApiError } from '@shared/api/errors.ts';
import { getProgress, toProgress, type ProgressSnapshot } from '@shared/api/progress.ts';

const snapshot = (over: Partial<ProgressSnapshot> = {}): ProgressSnapshot => ({
  state: 'swiping',
  hostId: 'host',
  deadlineAt: null,
  voteDeadlineAt: null,
  candidateCount: 3,
  participants: [
    {
      userId: 'b',
      displayName: 'Ben',
      joinedAt: '2026-10-02T10:02:00Z',
      answered: 3,
      voted: false,
    },
    {
      userId: 'a',
      displayName: 'Ava',
      joinedAt: '2026-10-02T10:01:00Z',
      answered: 1,
      voted: false,
    },
    {
      userId: 'host',
      displayName: 'Mike',
      joinedAt: '2026-10-02T10:00:00Z',
      answered: 3,
      voted: true,
    },
  ],
  ...over,
});

test('done = answered every candidate; host first, then by join time', () => {
  const p = toProgress(snapshot(), 'a');
  expect(p.participants.map((x) => [x.displayName, x.done, x.isHost, x.isMe])).toEqual([
    ['Mike', true, true, false],
    ['Ava', false, false, true],
    ['Ben', true, false, false],
  ]);
  expect(p).toMatchObject({ doneCount: 2, votedCount: 1, total: 3, state: 'swiping' });
});

test('never includes answer counts, only done/voted', () => {
  const json = JSON.stringify(toProgress(snapshot(), 'a'));
  expect(json).not.toContain('answered');
});

test('nobody is done before the pool exists', () => {
  const p = toProgress(snapshot({ state: 'draft', candidateCount: 0 }), 'a');
  expect(p.doneCount).toBe(0);
});

test('a missing name shows as "Someone"', () => {
  const s = snapshot();
  s.participants[0]!.displayName = '  ';
  expect(toProgress(s, 'a').participants.find((x) => x.userId === 'b')?.displayName).toBe(
    'Someone',
  );
});

test('participants only: strangers get 403, unknown Picks 404', async () => {
  const store = { loadProgress: async (id: string) => (id === 'p' ? snapshot() : null) };
  await expect(getProgress(store, 'p', 'a')).resolves.toMatchObject({ total: 3 });
  await expect(getProgress(store, 'p', 'stranger')).rejects.toMatchObject({
    status: 403,
    code: 'FORBIDDEN',
  });
  const missing = await getProgress(store, 'nope', 'a').catch((e: unknown) => e);
  expect(missing).toBeInstanceOf(ApiError);
  expect(missing).toMatchObject({ status: 404, code: 'PICK_NOT_FOUND' });
});

test('during the final vote, the deadline is the vote deadline (not the long-passed swipe one)', () => {
  const s = snapshot({
    state: 'final_vote',
    deadlineAt: '2026-10-20T10:00:00Z',
    voteDeadlineAt: '2026-10-20T10:40:00Z',
  });
  expect(toProgress(s, 'a').deadlineAt).toBe('2026-10-20T10:40:00Z');
  expect(toProgress({ ...s, state: 'swiping' }, 'a').deadlineAt).toBe('2026-10-20T10:00:00Z');
});
