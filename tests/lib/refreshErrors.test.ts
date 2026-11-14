import { isAccessDenied } from '@/lib/errors';
import { queries, QueryError } from '@/lib/queries';
import { getSupabase } from '@/lib/supabase';
jest.mock('@/lib/config', () => ({ USE_MOCK: false }));
jest.mock('@/lib/mock/queries', () => ({ mockQueries: {} }));
jest.mock('@/lib/supabase', () => ({ getSupabase: jest.fn() }));
test.each([401, 403, 404])('structured HTTP %s clears inaccessible projections', (status) => {
  expect(isAccessDenied(Object.assign(new Error('Denied'), { status }))).toBe(true);
});
test.each([
  new Error('Network 401 mentioned in text'),
  { status: 0 },
  { status: 500 },
  { code: '08006' },
  null,
])('transient or unstructured errors are not authorization denials: %p', (error) => {
  expect(isAccessDenied(error)).toBe(false);
});
test.each([
  ['42501', 403],
  ['PGRST301', 401],
  ['08006', 503],
])(
  'group query preserves code %s and HTTP status for refresh classification',
  async (code, status) => {
    const eq = jest
      .fn()
      .mockResolvedValue({ data: null, error: { message: 'Failed', code }, status });
    jest.mocked(getSupabase).mockReturnValue({ from: () => ({ select: () => ({ eq }) }) } as any);
    let failure: unknown;
    try {
      await queries.listMyGroups('me');
    } catch (e) {
      failure = e;
    }
    expect(failure).toBeInstanceOf(QueryError);
    expect(failure).toMatchObject({ code, status, message: 'Failed' });
    expect(isAccessDenied(failure)).toBe(status === 401 || status === 403);
  },
);
