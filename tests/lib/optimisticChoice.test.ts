import { OptimisticChoice, mutationStamp } from '@/lib/optimisticChoice';
import { canRsvpHang, canRsvpPlan, projectHangRsvp, projectPlanRsvp } from '@/lib/optimisticRsvp';
import type { PlanSummary, RsvpStatus } from '@shared/api/plans.ts';
import type { HangPost } from '@shared/api/hang.ts';
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
function fixture(initial = false) {
  const first = deferred<boolean>();
  const write = jest
    .fn()
    .mockImplementationOnce(() => first.promise)
    .mockImplementation(async (value: boolean) => value);
  const read = jest.fn(async () => false);
  const choice = new OptimisticChoice<boolean, boolean>(
    { read, write, project: (_, value) => value, selected: (v) => v, eligible: () => true },
    initial,
  );
  return { choice, first, read, write };
}
const failure = (status: number) => Object.assign(new Error('Rejected'), { status });

test('immediate save, latest desire and coalescing avoid uncontrolled duplicate requests', async () => {
  const { choice, first, write } = fixture();
  choice.choose(true);
  expect(choice.snapshot()).toMatchObject({ confirmed: false, value: true, pending: true });
  choice.choose(false);
  choice.choose(true);
  expect(write).toHaveBeenCalledTimes(1);
  first.resolve(true);
  await flush();
  expect(choice.snapshot()).toMatchObject({ confirmed: true, value: true, pending: false });
  expect(write).toHaveBeenCalledTimes(1);
});
test('a newer removal is sent only after the original save settles', async () => {
  const { choice, first, write } = fixture();
  choice.choose(true);
  choice.choose(false);
  expect(choice.snapshot().value).toBe(false);
  expect(write).toHaveBeenCalledTimes(1);
  first.resolve(true);
  await flush();
  expect(write.mock.calls.map(([value]) => value)).toEqual([true, false]);
  expect(choice.snapshot().confirmed).toBe(false);
});
test('old refresh and older mutation acknowledgement never replace a newer desired state', async () => {
  const { choice, first } = fixture();
  const old = mutationStamp();
  choice.choose(true);
  choice.accept(false, old);
  expect(choice.snapshot().value).toBe(true);
  choice.choose(false);
  first.resolve(true);
  await flush();
  choice.accept(true, old);
  expect(choice.snapshot().value).toBe(false);
});
test('out-of-order refresh responses are ignored', () => {
  const { choice } = fixture();
  const old = mutationStamp();
  const fresh = mutationStamp();
  choice.accept(true, fresh);
  choice.accept(false, old);
  expect(choice.snapshot().value).toBe(true);
});
test('a definitive failure rolls back and permits explicit retry', async () => {
  const { choice, first, write } = fixture();
  choice.choose(true);
  first.reject(failure(400));
  await flush();
  expect(choice.snapshot()).toMatchObject({ value: false, pending: false, error: 'Rejected' });
  choice.choose(true);
  await flush();
  expect(write).toHaveBeenCalledTimes(2);
  expect(choice.snapshot().value).toBe(true);
});
test('an older definitive failure does not roll back a newer intent', async () => {
  const { choice, first, write } = fixture();
  choice.choose(true);
  choice.choose(false);
  first.reject(failure(400));
  await flush();
  expect(choice.snapshot()).toMatchObject({ value: false, pending: false });
  expect(write).toHaveBeenCalledTimes(1);
});
test('ambiguous failures read authority instead of assuming the write failed', async () => {
  const { choice, first, read } = fixture();
  read.mockResolvedValue(true);
  choice.choose(true);
  first.reject(new Error('Connection lost'));
  await flush();
  expect(read).toHaveBeenCalledTimes(1);
  expect(choice.snapshot()).toMatchObject({ value: true, pending: false, error: null });
});
test('an ambiguous failure that did not persist reconciles back with understandable feedback', async () => {
  const { choice, first } = fixture();
  choice.choose(true);
  first.reject(new Error('Offline'));
  await flush();
  expect(choice.snapshot()).toMatchObject({ value: false, pending: false });
  expect(choice.snapshot().error).toContain('not saved');
});
test('unconfirmed failures stop further writes until an authoritative refresh succeeds', async () => {
  const { choice, first, read, write } = fixture();
  read.mockRejectedValueOnce(new Error('Offline'));
  choice.choose(true);
  first.reject(new Error('Timeout'));
  await flush();
  expect(choice.snapshot()).toMatchObject({ value: false, pending: false, uncertain: true });
  expect(choice.choose(true)).toBe(false);
  expect(write).toHaveBeenCalledTimes(1);
  read.mockResolvedValue(true);
  await choice.refresh();
  expect(choice.snapshot()).toMatchObject({ value: true, uncertain: false, error: null });
});
test.each([401, 403, 404])(
  'authorization/entity failure %s clears protected projections and queued choices',
  async (status) => {
    const { choice, first } = fixture();
    choice.choose(true);
    choice.choose(false);
    first.reject(failure(status));
    await flush();
    expect(choice.snapshot().value).toBeNull();
    expect(choice.choose(true)).toBe(false);
  },
);
test('dispose ignores late writes and never sends the queued inverse', async () => {
  const { choice, first, write } = fixture();
  choice.choose(true);
  choice.choose(false);
  choice.dispose();
  first.resolve(true);
  await flush();
  expect(choice.snapshot().value).toBeNull();
  expect(write).toHaveBeenCalledTimes(1);
});
test('a cleared scope waits for its sent write before foreground revalidation', async () => {
  const { choice, first, read } = fixture();
  choice.choose(true);
  choice.clear();
  const reload = choice.refresh();
  expect(read).not.toHaveBeenCalled();
  first.resolve(true);
  await reload;
  expect(read).toHaveBeenCalledTimes(1);
  expect(choice.snapshot().value).toBe(false);
});
const plan = (): PlanSummary => ({
  state: 'completed',
  isHost: false,
  planAt: null,
  participantCount: 4,
  rsvps: { going: 1, maybe: 1, notGoing: 0 },
  myRsvp: 'maybe',
  outcomes: { went: 0, didNotGo: 0, again: 0 },
  myOutcome: null,
});
test('RSVP projection subtracts the old choice once and never double-counts server echoes', () => {
  const value = projectPlanRsvp(plan(), 'going');
  expect(value.rsvps).toEqual({ going: 2, maybe: 0, notGoing: 0 });
  expect(projectPlanRsvp(value, 'going').rsvps).toEqual(value.rsvps);
  expect(projectPlanRsvp(value, 'not_going').rsvps).toEqual({ going: 1, maybe: 0, notGoing: 1 });
});
test('a fresh participant snapshot while pending rebases totals without counting our vote twice', async () => {
  const first = deferred<PlanSummary>();
  const choice = new OptimisticChoice<PlanSummary, RsvpStatus>(
    {
      read: async () => plan(),
      write: () => first.promise,
      selected: (p) => p.myRsvp!,
      project: projectPlanRsvp,
      eligible: canRsvpPlan,
    },
    plan(),
  );
  choice.choose('going');
  choice.accept(
    { ...plan(), myRsvp: 'going', rsvps: { going: 3, maybe: 0, notGoing: 0 } },
    mutationStamp(),
  );
  expect(choice.snapshot().value?.rsvps.going).toBe(3);
  choice.choose('not_going');
  first.resolve({ ...plan(), myRsvp: 'going', rsvps: { going: 3, maybe: 0, notGoing: 0 } });
  // Stop after checking the overlay: a later desired choice remains distinct from that acknowledgement.
  await Promise.resolve();
  expect(choice.snapshot().value?.myRsvp).toBe('not_going');
  choice.dispose();
});
test('closed plans reject speculation and cancellation clears a pending projection', () => {
  const choice = new OptimisticChoice<PlanSummary, RsvpStatus>(
    {
      read: async () => plan(),
      write: async () => plan(),
      selected: (p) => p.myRsvp!,
      project: projectPlanRsvp,
      eligible: canRsvpPlan,
    },
    { ...plan(), state: 'canceled' },
  );
  expect(choice.choose('going')).toBe(false);
  expect(canRsvpPlan({ ...plan(), state: 'voting' })).toBe(false);
});
test('hang counts rebase Down → Maybe → Down and reject expired or converted events', () => {
  const post = {
    id: 'h',
    myStatus: 'down',
    downCount: 4,
    expiresAt: new Date(Date.now() + 10000).toISOString(),
  } as HangPost;
  const maybe = projectHangRsvp(post, 'maybe');
  expect(maybe.downCount).toBe(3);
  expect(projectHangRsvp(maybe, 'down').downCount).toBe(4);
  expect(projectHangRsvp(post, 'down').downCount).toBe(4);
  expect(canRsvpHang({ ...post, expiresAt: new Date(0).toISOString() })).toBe(false);
  expect(canRsvpHang({ ...post, pickId: 'pick' })).toBe(false);
});

test('an older post-write RSVP read cannot overwrite a newer participant snapshot', async () => {
  const older = deferred<PlanSummary>();
  const choice = new OptimisticChoice<PlanSummary, RsvpStatus>(
    {
      read: () => older.promise,
      write: async () => {},
      readAfterWrite: true,
      selected: (p) => p.myRsvp!,
      project: projectPlanRsvp,
      eligible: canRsvpPlan,
    },
    plan(),
  );
  choice.choose('going');
  await flush();
  choice.accept(
    { ...plan(), myRsvp: 'going', rsvps: { going: 3, maybe: 0, notGoing: 0 } },
    mutationStamp(),
  );
  older.resolve({ ...plan(), myRsvp: 'going', rsvps: { going: 2, maybe: 0, notGoing: 0 } });
  await flush();
  expect(choice.snapshot().confirmed?.rsvps.going).toBe(3);
  choice.dispose();
});
