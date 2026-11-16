import { SavedChoices } from '@/lib/savedChoices';
import { api } from '@/lib/api';
jest.mock('@/lib/api', () => ({
  api: { getSaved: jest.fn(), savePlace: jest.fn(), removeSaved: jest.fn() },
}));
const flush = async () => {
  for (let i = 0; i < 15; i++) await Promise.resolve();
};
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
let server: Set<string>;
const result = () => ({ places: [...server].map((placeId) => ({ placeId, createdAt: 'now' })) });
beforeEach(() => {
  jest.resetAllMocks();
  server = new Set(['a']);
  jest.mocked(api.getSaved).mockImplementation(async () => result());
  jest.mocked(api.savePlace).mockImplementation(async (id) => {
    server.add(id);
    return { status: 'ok' };
  });
  jest.mocked(api.removeSaved).mockImplementation(async (id) => {
    server.delete(id);
    return { status: 'ok' };
  });
});
test('cards and detail consumers share immediate state and one per-place request', async () => {
  const saved = new SavedChoices('A');
  await saved.reload();
  const card = saved.item('a');
  const details = saved.item('a');
  const first = deferred<{ status: 'ok' }>();
  jest.mocked(api.removeSaved).mockReturnValueOnce(first.promise);
  saved.toggle('a');
  expect(card.snapshot().value).toBe(false);
  expect(details.snapshot().value).toBe(false);
  expect(api.removeSaved).toHaveBeenCalledWith('a', 'A');
  first.resolve({ status: 'ok' });
  await flush();
  expect(details.snapshot().pending).toBe(false);
  saved.dispose();
});
test('Undo while removal is pending serializes a compensating save and restores server state', async () => {
  const saved = new SavedChoices('A');
  await saved.reload();
  const first = deferred<{ status: 'ok' }>();
  jest.mocked(api.removeSaved).mockImplementationOnce(async () => {
    const r = await first.promise;
    server.delete('a');
    return r;
  });
  saved.toggle('a');
  const token = saved.undo!.token;
  saved.restore(token);
  expect(saved.item('a').snapshot().value).toBe(true);
  expect(api.savePlace).not.toHaveBeenCalled();
  first.resolve({ status: 'ok' });
  await flush();
  expect(api.savePlace).toHaveBeenCalledWith('a', 'A');
  expect(server.has('a')).toBe(true);
  saved.dispose();
});
test('confirmed removal can be undone; a failed restoration rolls back and can be retried', async () => {
  const saved = new SavedChoices('A');
  await saved.reload();
  saved.toggle('a');
  await flush();
  expect(server.has('a')).toBe(false);
  jest
    .mocked(api.savePlace)
    .mockRejectedValueOnce(Object.assign(new Error('Limit reached'), { status: 400 }));
  saved.restore(saved.undo!.token);
  await flush();
  expect(saved.item('a').snapshot().value).toBe(false);
  expect(saved.feedback()).toBe('Limit reached');
  saved.toggle('a');
  await flush();
  expect(server.has('a')).toBe(true);
  saved.dispose();
});
test('failed removal restores the previous save and stale Undo is harmless', async () => {
  const saved = new SavedChoices('A');
  await saved.reload();
  jest
    .mocked(api.removeSaved)
    .mockRejectedValueOnce(Object.assign(new Error('Rejected'), { status: 400 }));
  saved.toggle('a');
  const token = saved.undo!.token;
  await flush();
  saved.restore(token);
  await flush();
  expect(saved.item('a').snapshot().value).toBe(true);
  expect(api.savePlace).not.toHaveBeenCalled();
  saved.dispose();
});
test('replaced and expired Undo tokens cannot restore another item or later intent', async () => {
  server.add('b');
  const saved = new SavedChoices('A');
  await saved.reload();
  saved.toggle('a');
  const first = saved.undo!.token;
  saved.toggle('b');
  const second = saved.undo!.token;
  saved.restore(first);
  expect(saved.item('a').snapshot().value).toBe(false);
  saved.dismissUndo(second);
  saved.restore(second);
  await flush();
  expect(api.savePlace).not.toHaveBeenCalled();
  saved.dispose();
});
test('stale collection reads cannot overwrite a mutation and rapid toggles serialize', async () => {
  const saved = new SavedChoices('A');
  await saved.reload();
  const stale = deferred<Awaited<ReturnType<typeof api.getSaved>>>();
  jest.mocked(api.getSaved).mockReturnValueOnce(stale.promise);
  const reload = saved.reload();
  saved.toggle('a');
  await flush();
  stale.resolve({ places: [{ placeId: 'a', createdAt: 'old' }] });
  await reload;
  expect(saved.item('a').snapshot().value).toBe(false);
  saved.dispose();
});
test('lost write acknowledgement reconciles with committed server state', async () => {
  const saved = new SavedChoices('A');
  await saved.reload();
  jest.mocked(api.removeSaved).mockImplementationOnce(async () => {
    server.delete('a');
    throw new Error('Lost response');
  });
  saved.toggle('a');
  await flush();
  expect(saved.item('a').snapshot()).toMatchObject({ value: false, error: null, uncertain: false });
  saved.dispose();
});
test('failed reconciliation disables the uncertain item until refresh', async () => {
  const saved = new SavedChoices('A');
  await saved.reload();
  jest.mocked(api.removeSaved).mockRejectedValueOnce(new Error('Timeout'));
  jest.mocked(api.getSaved).mockRejectedValueOnce(new Error('Offline'));
  saved.toggle('a');
  await flush();
  expect(saved.item('a').snapshot().uncertain).toBe(true);
  saved.toggle('a');
  expect(api.removeSaved).toHaveBeenCalledTimes(1);
  await saved.reload();
  expect(saved.item('a').snapshot().uncertain).toBe(false);
  saved.dispose();
});
test('authorization failure clears all saved state and the Undo action', async () => {
  const saved = new SavedChoices('A');
  await saved.reload();
  jest
    .mocked(api.removeSaved)
    .mockRejectedValueOnce(Object.assign(new Error('Denied'), { status: 403 }));
  saved.toggle('a');
  await flush();
  expect(saved.ready).toBe(false);
  expect(saved.undo).toBeNull();
  expect(saved.item('a').snapshot().value).toBeNull();
  saved.dispose();
});
test('account switch, unmount and hidden screen invalidate old Undo and late responses', async () => {
  const a = new SavedChoices('A');
  await a.reload();
  const first = deferred<{ status: 'ok' }>();
  jest.mocked(api.removeSaved).mockReturnValueOnce(first.promise);
  a.toggle('a');
  const token = a.undo!.token;
  a.dispose();
  server = new Set();
  const b = new SavedChoices('B');
  await b.reload();
  a.restore(token);
  first.resolve({ status: 'ok' });
  await flush();
  expect(b.item('a').snapshot().value).toBe(false);
  expect(api.savePlace).not.toHaveBeenCalled();
  b.toggle('x');
  await flush();
  b.toggle('x');
  const other = b.undo!.token;
  b.clear();
  b.restore(other);
  expect(b.undo).toBeNull();
  expect(b.ready).toBe(false);
  b.dispose();
});
