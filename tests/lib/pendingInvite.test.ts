// A parked invite token survives in SecureStore (native) and is resumed once.
const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  setItemAsync: async (k: string, v: string) => void mockStore.set(k, v),
  getItemAsync: async (k: string) => mockStore.get(k) ?? null,
  deleteItemAsync: async (k: string) => void mockStore.delete(k),
}));

const TOKEN = 'AbCdEfGhIjKlMnOpQrStU_';

beforeEach(() => {
  mockStore.clear();
  jest.resetModules();
});

const load = () => jest.requireActual<typeof import('@/lib/pendingInvite')>('@/lib/pendingInvite');

test('parks a token and resumes it once', async () => {
  const { setPendingInvite, takePendingInvite } = load();
  await setPendingInvite(TOKEN);
  await expect(takePendingInvite()).resolves.toBe(TOKEN);
  await expect(takePendingInvite()).resolves.toBeNull();
});

test('survives an app restart (a fresh module reads SecureStore)', async () => {
  await load().setPendingInvite(TOKEN);
  jest.resetModules();
  await expect(load().takePendingInvite()).resolves.toBe(TOKEN);
  expect(mockStore.size).toBe(0);
});

test('ignores malformed and week-old tokens', async () => {
  const { setPendingInvite, takePendingInvite } = load();
  await setPendingInvite('../not-a-token');
  await expect(takePendingInvite()).resolves.toBeNull();
  await setPendingInvite(TOKEN);
  jest.resetModules(); // the app restarts a week later
  await expect(load().takePendingInvite(Date.now() + 8 * 24 * 60 * 60 * 1000)).resolves.toBeNull();
});
