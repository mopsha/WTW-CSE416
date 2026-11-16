import { createApiClient, type FetchLike } from '@/lib/api';
import type { AuthSession } from '@/lib/auth';
const session = (id: string): AuthSession => ({
  user: { id, email: null },
  accessToken: `${id}-token`,
});
test('scoped writes never borrow a replacement account token', async () => {
  let resolve!: (s: AuthSession) => void;
  const fetch = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>();
  const api = createApiClient({
    baseUrl: 'https://test',
    fetch,
    getSession: () =>
      new Promise((yes) => {
        resolve = yes;
      }),
    getAccessToken: async () => 'B-token',
  });
  const pending = api.savePlace('place', 'A');
  resolve(session('B'));
  await expect(pending).rejects.toMatchObject({ status: 401, code: 'account_changed' });
  expect(fetch).not.toHaveBeenCalled();
});
test('saved and RSVP requests retain existing paths/bodies and use their captured owner token', async () => {
  const fetch = jest
    .fn<ReturnType<FetchLike>, Parameters<FetchLike>>()
    .mockImplementation(
      async () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 }),
    );
  const getAccessToken = jest.fn(async () => 'different-token');
  const api = createApiClient({
    baseUrl: 'https://test',
    fetch,
    getAccessToken,
    getSession: async () => session('A'),
  });
  await api.savePlace('x', 'A');
  await api.removeSaved('x', 'A');
  await api.rsvp('pick', 'maybe', 'A');
  await api.respondHang('h', 'down', 'A');
  expect(getAccessToken).not.toHaveBeenCalled();
  expect(fetch.mock.calls.map(([path]) => path)).toEqual([
    'https://test/saved/x',
    'https://test/saved/x',
    'https://test/picks/pick/rsvp',
    'https://test/hang/h/respond',
  ]);
  for (const [, init] of fetch.mock.calls)
    expect(init.headers).toMatchObject({ Authorization: 'Bearer A-token' });
  expect(fetch.mock.calls[2]![1].body).toBe(JSON.stringify({ status: 'maybe' }));
});
