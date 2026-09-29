import { AuthError, bearerToken, createGetUser } from '@shared/auth/getUser.ts';

const USER_ID = '6d27d3e0-6965-4389-86a5-2c9d9ae1111c';

function request(authorization?: string) {
  return new Request('https://example.test/api/picks/x/swipes', {
    method: 'POST',
    headers: authorization ? { Authorization: authorization } : {},
  });
}

function fakeFetch(status: number, body: unknown = {}) {
  return jest.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status }),
  );
}

const config = { supabaseUrl: 'https://proj.supabase.co/', apiKey: 'anon-key' };

describe('bearerToken', () => {
  it('extracts the token', () => {
    expect(bearerToken(request('Bearer abc.def.ghi'))).toBe('abc.def.ghi');
    expect(bearerToken(request('bearer abc'))).toBe('abc');
  });
  it('returns null for missing or malformed headers', () => {
    expect(bearerToken(request())).toBeNull();
    expect(bearerToken(request('Basic abc'))).toBeNull();
    expect(bearerToken(request('Bearer'))).toBeNull();
    expect(bearerToken(request('Bearer a b'))).toBeNull();
  });
});

describe('createGetUser', () => {
  it('asks Supabase Auth and returns the user id', async () => {
    const f = fakeFetch(200, { id: USER_ID, email: 'x@test.invalid' });
    const getUser = createGetUser({ ...config, fetch: f });
    await expect(getUser(request('Bearer tok'))).resolves.toEqual({ id: USER_ID });
    expect(f).toHaveBeenCalledWith('https://proj.supabase.co/auth/v1/user', {
      headers: { apikey: 'anon-key', Authorization: 'Bearer tok' },
    });
  });

  it('rejects a missing token without calling Auth', async () => {
    const f = fakeFetch(200, { id: USER_ID });
    const getUser = createGetUser({ ...config, fetch: f });
    await expect(getUser(request())).rejects.toBeInstanceOf(AuthError);
    expect(f).not.toHaveBeenCalled();
  });

  it.each([401, 403])('maps Auth %i to AuthError (401)', async (status) => {
    const getUser = createGetUser({ ...config, fetch: fakeFetch(status) });
    const error = await getUser(request('Bearer bad')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthError);
    expect(error).toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
  });

  it('rejects a response without a valid user id', async () => {
    const getUser = createGetUser({ ...config, fetch: fakeFetch(200, { id: 'nope' }) });
    await expect(getUser(request('Bearer tok'))).rejects.toBeInstanceOf(AuthError);
  });

  it('treats Auth outages as server errors, not 401', async () => {
    const getUser = createGetUser({ ...config, fetch: fakeFetch(500) });
    const error = await getUser(request('Bearer tok')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(AuthError);
  });

  it('fails closed when not configured', async () => {
    const getUser = createGetUser({ supabaseUrl: '', apiKey: '', fetch: fakeFetch(200) });
    await expect(getUser(request('Bearer tok'))).rejects.toThrow('not configured');
  });
});
