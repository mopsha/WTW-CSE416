import type { PickSummary } from './types';
import { pickTitle, STATE_LABEL } from './pickUi';

const ACTIVE = new Set(['draft', 'swiping', 'ranking', 'final_vote']);
export function historyDate(pick: PickSummary): string | null {
  for (const date of [pick.decidedAt, pick.createdAt]) {
    if (date && Number.isFinite(Date.parse(date))) return date;
  }
  return null;
}
/** Limit the presentation only; the query and full History remain unchanged in size. */
export function recentHistory(picks: readonly PickSummary[]): PickSummary[] {
  return picks
    .filter((p) => !ACTIVE.has(p.state))
    .sort((a, b) => {
      const time = (p: PickSummary) => Date.parse(historyDate(p) ?? '') || 0;
      // PostgreSQL timestamps retain microseconds; Date.parse alone loses sub-ms order.
      const micros = (p: PickSummary) => {
        const fraction = historyDate(p)?.match(/\.(\d+)(?:Z|[+-]\d{2}:?\d{2})$/)?.[1] ?? '';
        return Number((fraction.slice(3) + '000').slice(0, 3));
      };
      return time(b) - time(a) || micros(b) - micros(a) || a.id.localeCompare(b.id);
    })
    .slice(0, 5);
}
export function historyTitle(pick: PickSummary): string {
  return (pick.state === 'completed' && pick.winnerName?.trim()) || pickTitle(pick.category);
}
export function historySubtitle(pick: PickSummary): string {
  const date = historyDate(pick);
  return [
    STATE_LABEL[pick.state],
    pickTitle(pick.category),
    date
      ? new Date(date).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
