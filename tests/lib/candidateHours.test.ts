import { queries } from '@/lib/queries';
const mockGetPickHours = jest.fn();
const mockOrder = jest.fn();
jest.mock('@/lib/config', () => ({ USE_MOCK: false }));
jest.mock('@/lib/api', () => ({
  api: { getPickHours: (...args: unknown[]) => mockGetPickHours(...args) },
}));
jest.mock('@/lib/supabase', () => ({
  getSupabase: () => ({ from: () => ({ select: () => ({ eq: () => ({ order: mockOrder }) }) }) }),
}));

beforeEach(() => {
  mockOrder.mockResolvedValue({
    data: [{ place_id: 'a', snapshot: { name: 'Original', rating: 4 } }],
    error: null,
  });
});
test('candidate reads retain identity/display data and attach only matching hours', async () => {
  mockGetPickHours.mockResolvedValue({
    candidateHours: [
      { placeId: 'a', openNow: true, closesAt: null },
      { placeId: 'other', openNow: false },
    ],
  });
  expect(await queries.getCandidates('pick')).toEqual([
    {
      placeId: 'a',
      name: 'Original',
      rating: 4,
      photoUrl: null,
      priceLevel: null,
      cuisine: null,
      address: null,
      lat: null,
      lng: null,
      openNow: true,
      closesAt: null,
    },
  ]);
  expect(mockGetPickHours).toHaveBeenCalledWith('pick');
});
test('hours read failure leaves persisted candidates usable with unknown hours', async () => {
  mockGetPickHours.mockRejectedValue(new Error('unavailable'));
  expect(await queries.getCandidates('pick')).toEqual([
    {
      placeId: 'a',
      name: 'Original',
      rating: 4,
      photoUrl: null,
      priceLevel: null,
      cuisine: null,
      address: null,
      lat: null,
      lng: null,
      openNow: null,
      closesAt: null,
    },
  ]);
});
