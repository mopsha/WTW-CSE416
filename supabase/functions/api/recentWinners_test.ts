import { createApp } from './app.ts';
import { resolveRecentWinners } from '../_shared/api/recentWinners.ts';
import { ApiError } from '../_shared/api/errors.ts';
import type { RecentWinner } from '../_shared/api/recentWinners.ts';
function assert(value: unknown): asserts value {
  if (!value) throw new Error('Assertion failed');
}
const ids = Array.from({ length: 6 }, (_, n) => `5600000${n}-2222-4222-8222-222222222222`);
const userId = '56000999-2222-4222-8222-222222222222';
Deno.test(
  'recent winners authenticates before reads, bounds requests and uses only authorized persisted winners',
  async () => {
    let auth = true,
      reads = 0,
      calls = 0;
    let rows: RecentWinner[] = [
      { pickId: ids[0], placeId: 'canonical', snapshot: { provider: 'google' } },
    ];
    let mode = 'ok';
    const app = createApp({
      getUser: async () => {
        if (!auth) throw new ApiError(401, 'UNAUTHORIZED', 'Sign in');
        return { id: userId };
      },
      store: {} as never,
      lifecycleStore: {} as never,
      closingStore: {} as never,
      poolBuilder: {} as never,
      recentWinnersStore: {
        load: async (viewer, requested) => {
          reads++;
          assert(viewer === userId && requested.length <= 5);
          return rows;
        },
      },
      winnerDetails: async (placeId) => {
        calls++;
        assert(placeId === 'canonical');
        if (mode === 'quota') throw new ApiError(429, 'RATE_LIMITED', 'Quota');
        if (mode === 'unavailable') return null;
        return {
          placeId: mode === 'wrong' ? 'other' : placeId,
          name: 'Live name',
          category: 'food',
          lat: 40,
          lng: -73,
          provider: 'google',
          retention: 'request',
          googleMapsUri: 'https://maps.google.com/place',
          attributions: [{ provider: 'Data source', providerUri: 'https://example.com' }],
        };
      },
    });
    const post = (body: unknown) =>
      app.request('/picks/recent-winners', { method: 'POST', body: JSON.stringify(body) });
    auth = false;
    assert((await post({ pickIds: [ids[0]] })).status === 401);
    assert(reads === 0 && calls === 0);
    auth = true;
    for (const pickIds of [[], ids, ['invalid'], 'invalid'])
      assert((await post({ pickIds })).status === 400);
    assert(reads === 0);
    const response = await post({ pickIds: [ids[0]], userId: 'spoofed', placeId: 'other' });
    assert(
      response.status === 200 && response.headers.get('Cache-Control') === 'private, no-store',
    );
    const body = await response.json();
    assert(body.winners[0].placeId === 'canonical' && body.winners[0].name === 'Live name');
    assert(body.winners[0].attributions[0].provider === 'Data source');
    assert(!('lat' in body.winners[0]) && !('retention' in body.winners[0]));
    for (const failure of ['quota', 'unavailable', 'wrong']) {
      mode = failure;
      assert((await (await post({ pickIds: [ids[0]] })).json()).winners.length === 0);
    }
    mode = 'ok';
    rows = [];
    const before = calls;
    assert((await (await post({ pickIds: [ids[0]] })).json()).winners.length === 0);
    assert(calls === before); // Non-participant, canceled or missing winner: store returns no row.
    rows = [{ pickId: ids[0], placeId: 'stored', snapshot: { provider: 'custom' } }];
    assert((await (await post({ pickIds: [ids[0]] })).json()).winners.length === 0);
    assert(calls === before);
    rows = ids
      .slice(0, 5)
      .map((pickId) => ({ pickId, placeId: 'canonical', snapshot: { provider: 'google' } }));
    const five = await (await post({ pickIds: ids.slice(0, 5) })).json();
    assert(five.winners.length === 5 && calls === before + 1); // Deduplicate repeated places.
  },
);

Deno.test(
  'missing provider configuration fails softly even when details throws synchronously',
  async () => {
    const result = await resolveRecentWinners(
      {
        load: async () => [
          {
            pickId: ids[0],
            placeId: 'canonical',
            snapshot: { provider: 'google' },
          },
        ],
      },
      userId,
      [ids[0]],
      () => {
        throw new Error('Provider not configured');
      },
    );
    assert(result.length === 0);
  },
);
