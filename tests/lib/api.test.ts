import { ApiError, createApiClient, parseErrorBody, type FetchLike } from '@/lib/api';

const BASE = 'https://example.test/functions/v1/api';

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

function client(fetch: FetchLike, token: string | null = 'user-jwt') {
  return createApiClient({ baseUrl: BASE, getAccessToken: async () => token, fetch });
}

async function caught(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    return e as ApiError;
  }
  throw new Error('expected the request to throw');
}

describe('parseErrorBody', () => {
  test('reads { error: { code, message } }', () => {
    expect(parseErrorBody({ error: { code: 'INVALID_PICK_STATE', message: 'Closed.' } })).toEqual({
      code: 'INVALID_PICK_STATE',
      message: 'Closed.',
    });
  });

  test.each([
    null,
    'oops',
    {},
    { error: 'x' },
    { error: { code: 1, message: 'm' } },
    { error: { code: 'c' } },
  ])('returns null for %p', (body) => {
    expect(parseErrorBody(body)).toBeNull();
  });
});

describe('createApiClient', () => {
  test('POSTs the swipe with the bearer token and JSON body', async () => {
    const fetch = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>(async () =>
      jsonResponse(200, { status: 'ok' }),
    );
    await expect(client(fetch).submitSwipe('pick 1', 'place-9', 2)).resolves.toEqual({
      status: 'ok',
    });

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(`${BASE}/picks/pick%201/swipes`);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer user-jwt',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(init.body))).toEqual({ placeId: 'place-9', value: 2 });
  });

  test('turns the API error shape into a typed ApiError', async () => {
    const fetch: FetchLike = async () =>
      jsonResponse(409, { error: { code: 'INVALID_PICK_STATE', message: 'Pick must be swiping' } });
    const err = await caught(client(fetch).rankPick('p1'));
    expect(err.code).toBe('INVALID_PICK_STATE');
    expect(err.message).toBe('Pick must be swiping');
    expect(err.status).toBe(409);
  });

  test('falls back to http_<status> when the body is not the error shape', async () => {
    const fetch: FetchLike = async () => new Response('<html>Bad Gateway</html>', { status: 502 });
    const err = await caught(client(fetch).rankPick('p1'));
    expect(err.code).toBe('http_502');
    expect(err.status).toBe(502);
  });

  test('maps a thrown fetch (offline) to network_error', async () => {
    const fetch: FetchLike = async () => {
      throw new TypeError('Network request failed');
    };
    const err = await caught(client(fetch).submitSwipe('p1', 'x', 0));
    expect(err.code).toBe('network_error');
    expect(err.status).toBe(0);
  });

  test('refuses to write without a session and never calls fetch', async () => {
    const fetch = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>();
    const err = await caught(client(fetch, null).submitSwipe('p1', 'x', 1));
    expect(err.code).toBe('not_signed_in');
    expect(fetch).not.toHaveBeenCalled();
  });

  test('/health needs no token', async () => {
    const fetch = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>(async () =>
      jsonResponse(200, { status: 'ok' }),
    );
    await client(fetch, null).health();
    expect(fetch.mock.calls[0]![1].headers).not.toHaveProperty('Authorization');
  });

  test('accepts an empty success body', async () => {
    const fetch: FetchLike = async () => new Response(null, { status: 204 });
    await expect(client(fetch).submitSwipe('p1', 'x', 1)).resolves.toBeNull();
  });

  test('returns the rank decision (positions only)', async () => {
    const body = {
      results: [{ placeId: 'a', rank: 1 }],
      decision: { kind: 'winner', winner: { placeId: 'a', rank: 1 } },
    };
    const fetch: FetchLike = async () => jsonResponse(200, body);
    await expect(client(fetch).rankPick('p1')).resolves.toEqual(body);
  });

  test('a non-host rank attempt surfaces the 403 FORBIDDEN code', async () => {
    const fetch: FetchLike = async () =>
      jsonResponse(403, {
        error: { code: 'FORBIDDEN', message: 'Only the host can close swiping and rank' },
      });
    const err = await caught(client(fetch).rankPick('p1'));
    expect([err.code, err.status]).toEqual(['FORBIDDEN', 403]);
  });
});
