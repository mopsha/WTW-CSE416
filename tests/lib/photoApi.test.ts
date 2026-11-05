import { createApiClient, type FetchLike } from '@/lib/api';
import type { AuthSession } from '@/lib/auth';
const bytes = new Uint8Array([255, 216, 255, 217]);
const ref = { userId: 'friend', revision: 1 };
const jpeg = () => new Response(bytes.buffer, { headers: { 'Content-Type': 'image/jpeg' } });
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function fixture() {
  let session: AuthSession | null = { user: { id: 'A', email: null }, accessToken: 'first-token' };
  const fetch = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>();
  const refresh = jest.fn(async () => {
    session = { user: { id: 'A', email: null }, accessToken: 'fresh-token' };
    return session;
  });
  const api = createApiClient({
    baseUrl: 'https://test',
    getAccessToken: async () => session?.accessToken ?? null,
    getSession: async () => session,
    refreshSession: refresh,
    fetch,
  });
  return {
    api,
    fetch,
    refresh,
    setSession: (value: AuthSession | null) => {
      session = value;
    },
  };
}
test('downloads private JPEG bytes with headers and produces a memory data URI', async () => {
  const { api, fetch } = fixture();
  fetch.mockResolvedValueOnce(jpeg());
  expect(await api.getAvatar('A', ref)).toBe('data:image/jpeg;base64,/9j/2Q==');
  expect(fetch).toHaveBeenCalledWith(
    'https://test/users/friend/avatar?revision=1',
    expect.objectContaining({
      cache: 'no-store',
      headers: expect.objectContaining({ Authorization: 'Bearer first-token' }),
    }),
  );
  expect(fetch.mock.calls[0]?.[0]).not.toContain('token');
});
test('refreshes once on 401, never retries an authorization denial or loops', async () => {
  const { api, fetch, refresh } = fixture();
  fetch.mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(jpeg());
  await api.getAvatar('A', ref);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[1]?.[1].headers).toMatchObject({ Authorization: 'Bearer fresh-token' });
  fetch.mockResolvedValue(
    json({ error: { code: 'PHOTO_UNAVAILABLE', message: 'Photo unavailable' } }, 404),
  );
  await expect(api.getAvatar('A', ref)).rejects.toMatchObject({ status: 404 });
  expect(refresh).toHaveBeenCalledTimes(1);
});
test('account mismatch prevents uploads; a switch during download discards bytes', async () => {
  const { api, fetch, setSession } = fixture();
  await expect(api.uploadAvatar('B', 0, bytes)).rejects.toMatchObject({ code: 'account_changed' });
  expect(fetch).not.toHaveBeenCalled();
  fetch.mockImplementationOnce(async () => {
    setSession(null);
    return jpeg();
  });
  await expect(api.getAvatar('A', ref)).rejects.toMatchObject({ code: 'account_changed' });
});
test('a same-ID mock account switch is rejected before private bytes are returned', async () => {
  const { api, fetch, setSession } = fixture();
  fetch.mockImplementationOnce(async () => {
    setSession({ user: { id: 'A', email: 'second@example.com' }, accessToken: 'second' });
    return jpeg();
  });
  await expect(api.getAvatar('A', ref)).rejects.toMatchObject({ code: 'account_changed' });
});
test('uploads binary JPEGs, removes with revisions and preserves server conflicts', async () => {
  const { api, fetch } = fixture();
  fetch.mockResolvedValueOnce(json({ revision: 1, avatarRef: { userId: 'A', revision: 1 } }));
  await api.uploadAvatar('A', 0, bytes);
  expect(fetch.mock.calls[0]?.[1].body).toBeInstanceOf(ArrayBuffer);
  expect(fetch.mock.calls[0]?.[1].headers).toMatchObject({ 'Content-Type': 'image/jpeg' });
  fetch.mockResolvedValueOnce(json({ revision: 2, avatarRef: null }));
  expect(await api.removeAvatar('A', 1)).toEqual({ revision: 2, avatarRef: null });
  fetch.mockResolvedValueOnce(json({ error: { code: 'PHOTO_CONFLICT', message: 'Changed' } }, 409));
  await expect(api.uploadAvatar('A', 0, bytes)).rejects.toMatchObject({ code: 'PHOTO_CONFLICT' });
});
test('rejects invalid/oversized uploads before network and caps hanging requests', async () => {
  const { api, fetch } = fixture();
  await expect(api.uploadAvatar('A', 0, new Uint8Array(1048577))).rejects.toMatchObject({
    code: 'INVALID_IMAGE',
  });
  expect(fetch).not.toHaveBeenCalled();
  jest.useFakeTimers();
  try {
    fetch.mockImplementationOnce(() => new Promise(() => {}));
    const result = api.getAvatar('A', ref);
    const assertion = expect(result).rejects.toMatchObject({ code: 'network_error' });
    await jest.advanceTimersByTimeAsync(10_001);
    await assertion;
  } finally {
    jest.useRealTimers();
  }
});
