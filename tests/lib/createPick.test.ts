import { ApiError, createApiClient, type FetchLike } from '@/lib/api';
import { MOCK_ACCESS_TOKEN } from '@/lib/mock/auth';
import { MOCK_API_BASE_URL, mockFetch } from '@/lib/mock/api';
import { mockQueries } from '@/lib/mock/queries';
import { mockPicks, resetMockData } from '@/lib/mock/store';
import type { CreatePickInput } from '@shared/domain/createPick.ts';

const input = (): CreatePickInput => ({
  category: 'activities',
  center: { lat: 40.9465, lng: -73.0693 },
  radiusM: 3219,
  poolSize: 15,
  deadlineAt: new Date(Date.now() + 60 * 60_000).toISOString(),
  closeThreshold: 75,
});

const mockClient = (token: string | null = MOCK_ACCESS_TOKEN) =>
  createApiClient({
    baseUrl: MOCK_API_BASE_URL,
    getAccessToken: async () => token,
    fetch: mockFetch,
  });

beforeEach(() => resetMockData());

test('createPick POSTs the input to /picks with the bearer token', async () => {
  const fetch = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>(
    async () => new Response(JSON.stringify({ pickId: 'p1', state: 'draft' }), { status: 201 }),
  );
  const api = createApiClient({
    baseUrl: 'https://x.test/api',
    getAccessToken: async () => 'jwt',
    fetch,
  });
  const body = input();
  await expect(api.createPick(body)).resolves.toEqual({ pickId: 'p1', state: 'draft' });
  const [url, init] = fetch.mock.calls[0]!;
  expect(url).toBe('https://x.test/api/picks');
  expect(init.method).toBe('POST');
  expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt');
  expect(JSON.parse(init.body as string)).toEqual(body);
});

describe('mock POST /picks', () => {
  test('creates a draft Pick I host, listed first', async () => {
    const { pickId, state } = await mockClient().createPick(input());
    expect(state).toBe('draft');
    expect(mockPicks.get(pickId)?.hostId).toBeTruthy();
    expect(mockPicks.get(pickId)?.poolSize).toBe(15);
    const [first] = await mockQueries.listMyPicks('me');
    expect(first).toMatchObject({ id: pickId, state: 'draft', category: 'activities' });
  });

  test('rejects invalid input with 400 INVALID_INPUT and creates nothing', async () => {
    const before = mockPicks.size;
    const err = await mockClient()
      .createPick({ ...input(), poolSize: 99 })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400, code: 'INVALID_INPUT' });
    expect(mockPicks.size).toBe(before);
  });

  test('needs a signed-in user', async () => {
    await expect(mockClient('wrong').createPick(input())).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
    });
  });
});
