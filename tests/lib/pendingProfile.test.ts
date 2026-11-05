// A parked invite target survives in SecureStore (native) and is resumed once.
const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  setItemAsync: async (k: string, v: string) => void mockStore.set(k, v),
  getItemAsync: async (k: string) => mockStore.get(k) ?? null,
  deleteItemAsync: async (k: string) => void mockStore.delete(k),
}));

const TOKEN = 'a0360001-3333-4333-8333-333333333333';

beforeEach(() => {
  mockStore.clear();
  jest.resetModules();
});

const load = () =>
  jest.requireActual<typeof import('@/lib/pendingProfile')>('@/lib/pendingProfile');

test('parks a target and resumes it once', async () => {
  const { setPendingProfile, takePendingProfile } = load();
  await setPendingProfile(TOKEN);
  await expect(takePendingProfile()).resolves.toBe(TOKEN);
  await expect(takePendingProfile()).resolves.toBeNull();
});

test('survives an app restart (a fresh module reads SecureStore)', async () => {
  await load().setPendingProfile(TOKEN);
  jest.resetModules();
  await expect(load().takePendingProfile()).resolves.toBe(TOKEN);
  expect(mockStore.size).toBe(0);
});

test('ignores malformed and day-old targets', async () => {
  const { setPendingProfile, takePendingProfile } = load();
  await setPendingProfile('../not-a-target');
  await expect(takePendingProfile()).resolves.toBeNull();
  await setPendingProfile(TOKEN);
  jest.resetModules(); // the app restarts a day later
  await expect(load().takePendingProfile(Date.now() + 8 * 24 * 60 * 60 * 1000)).resolves.toBeNull();
});

test('concurrent consumers receive a saved intent at most once', async () => {
  const p = load();
  await p.setPendingProfile(TOKEN);
  expect(
    await Promise.all([p.takePendingProfile(), p.takePendingProfile(), p.takePendingProfile()]),
  ).toEqual([TOKEN, null, null]);
});
test('stale session completion never navigates and preserves the intent for the next session', async () => {
  const p = load();
  await p.setPendingProfile(TOKEN);
  let current = true;
  const navigate = jest.fn();
  const work = p.resumePendingProfile(() => current, navigate);
  current = false;
  await work;
  expect(navigate).not.toHaveBeenCalled();
  await p.resumePendingProfile(() => true, navigate);
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(navigate).toHaveBeenCalledWith(TOKEN);
});
test('stale work cannot overwrite a newer saved target', async () => {
  const p = load();
  await p.setPendingProfile(TOKEN);
  let current = true;
  const navigate = jest.fn();
  const work = p.resumePendingProfile(() => current, navigate);
  const newer = 'a0360002-3333-4333-8333-333333333333';
  const save = p.setPendingProfile(newer);
  current = false;
  await Promise.all([work, save]);
  expect(await p.takePendingProfile()).toBe(newer);
  expect(navigate).not.toHaveBeenCalled();
});

test('a transient SecureStore read failure cannot replay the memory intent to another consumer', async () => {
  const p = load();
  await p.setPendingProfile(TOKEN);
  const store = jest.requireMock('expo-secure-store');
  const original = store.getItemAsync;
  let fail = true;
  store.getItemAsync = async (key: string) => {
    if (fail) {
      fail = false;
      throw new Error('temporary');
    }
    return original(key);
  };
  try {
    expect(await Promise.all([p.takePendingProfile(), p.takePendingProfile()])).toEqual([
      TOKEN,
      null,
    ]);
  } finally {
    store.getItemAsync = original;
  }
});
