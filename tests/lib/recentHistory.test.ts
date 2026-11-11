import { historyDate, historySubtitle, historyTitle, recentHistory } from '@/lib/recentHistory';
import type { PickSummary } from '@/lib/types';

const pick = (id: string, overrides: Partial<PickSummary> = {}): PickSummary => ({
  id,
  category: 'food',
  state: 'completed',
  deadlineAt: null,
  ...overrides,
});
test('only the latest five terminal Picks are previewed without truncating or mutating source data', () => {
  const picks = [2, 7, 1, 4, 6, 3, 5].map((n) =>
    pick(String(n), { decidedAt: `2026-11-0${n}T12:00:00Z` }),
  );
  picks.push(pick('active', { state: 'final_vote', createdAt: '2026-12-01T00:00:00Z' }));
  const before = [...picks];
  expect(recentHistory(picks).map((p) => p.id)).toEqual(['7', '6', '5', '4', '3']);
  expect(picks).toEqual(before);
  expect(picks).toHaveLength(8);
});
test.each([
  ['food', 'Noodle House'],
  ['activities', 'Botanical Gardens'],
  ['both', 'Escape Room'],
  ['custom', 'Movie at Sam’s'],
])('decided %s uses only its actual winner name', (category, winnerName) => {
  expect(historyTitle(pick('id', { category, winnerName }))).toBe(winnerName);
  expect(historySubtitle(pick('id', { category, winnerName }))).toContain('Decided');
});
test.each([
  ['food', 'Food Pick'],
  ['activities', 'Activities Pick'],
  ['both', 'Food + Activities Pick'],
  ['custom', 'Custom Plan'],
])('%s falls back for missing/deleted, blank and canceled winners', (category, title) => {
  for (const winnerName of [null, '', '   ']) {
    expect(historyTitle(pick('id', { category, winnerName }))).toBe(title);
  }
  expect(
    historyTitle(pick('id', { category, state: 'canceled', winnerName: 'Stale winner' })),
  ).toBe(title);
});
test('canceled Picks use creation dates; invalid or absent dates are omitted safely', () => {
  const canceled = pick('canceled', { state: 'canceled', createdAt: '2026-11-09T12:00:00Z' });
  expect(recentHistory([pick('older', { decidedAt: '2026-11-08T12:00:00Z' }), canceled])[0]).toBe(
    canceled,
  );
  expect(historySubtitle(canceled)).toContain('Canceled · Food Pick · ');
  expect(historyDate(pick('id', { decidedAt: 'bad date', createdAt: canceled.createdAt }))).toBe(
    canceled.createdAt,
  );
  expect(historySubtitle(pick('id', { decidedAt: 'bad date' }))).toBe('Decided · Food Pick');
  expect(recentHistory([])).toEqual([]);
});

test('equal completion times use stable ID order regardless of input order', () => {
  const tied = ['b', 'a', 'c'].map((id) => pick(id, { decidedAt: '2026-01-01T12:00:00Z' }));
  expect(recentHistory(tied).map((p) => p.id)).toEqual(['a', 'b', 'c']);
});

test('server timestamp microseconds are preserved before applying the ID tie breaker', () => {
  const older = pick('a', { decidedAt: '2026-01-01T12:00:00.000001+00:00' });
  const newer = pick('b', { decidedAt: '2026-01-01T12:00:00.000002+00:00' });
  expect(recentHistory([older, newer]).map((p) => p.id)).toEqual(['b', 'a']);
});
