import { attendanceDue } from '@shared/domain/pastMoves.ts';
// After the winner (Alan): plan-time presets, labels, and when to ask "Did you go?".
// Pure functions so the Winner screen stays simple and these stay tested.
import type { PlanSummary } from '@shared/api/plans.ts';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function clock(d: Date): string {
  const h = d.getHours() % 12 || 12;
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** "Today 8:00 PM", "Tomorrow 7:00 PM", "Sat 7:00 PM" (this week), "Nov 12, 7:00 PM". */
export function formatPlanTime(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  const days = Math.round((startOfDay(at) - startOfDay(now)) / 86_400_000);
  if (days === 0) return `Today ${clock(at)}`;
  if (days === 1) return `Tomorrow ${clock(at)}`;
  if (days > 1 && days < 7) return `${DAYS[at.getDay()]} ${clock(at)}`;
  return `${MONTHS[at.getMonth()]} ${at.getDate()}, ${clock(at)}`;
}

function at(base: Date, addDays: number, hour: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + addDays, hour, 0, 0, 0);
}

/** Calendar presets use the device timezone, including daylight-saving transitions. */
export function planTimeOptions(now: Date = new Date()): { label: string; value: string }[] {
  const options = [{ label: 'In 1 hour', at: new Date(now.getTime() + 60 * 60_000) }];
  const tonight = at(now, 0, 19);
  if (tonight.getTime() > now.getTime()) options.push({ label: 'Tonight at 7 PM', at: tonight });
  options.push({ label: 'Tomorrow at 7 PM', at: at(now, 1, 19) });
  return options.map((o) => ({ label: o.label, value: o.at.toISOString() }));
}

export function planTimeProblem(date: Date, now = Date.now()): string | null {
  const value = date.getTime();
  if (!Number.isFinite(value)) return 'Choose a valid date and time.';
  if (value <= now) return 'Choose a time in the future.';
  if (value - now > 30 * 24 * 60 * 60_000) return 'Choose a time within 30 days.';
  return null;
}

/** Change only the selected calendar fields; keep the other half of the draft. */
export function changePlanDate(current: Date, selected: Date, mode: 'date' | 'time'): Date {
  return mode === 'date'
    ? new Date(
        selected.getFullYear(),
        selected.getMonth(),
        selected.getDate(),
        current.getHours(),
        current.getMinutes(),
      )
    : new Date(
        current.getFullYear(),
        current.getMonth(),
        current.getDate(),
        selected.getHours(),
        selected.getMinutes(),
      );
}

/**
 * Ask an hour after the plan time (so nobody answers "Didn't happen" as it starts), or 3 hours
 * after the decision when no time was set. The push (pick_plan_targets) is a later nudge for
 * people who haven't opened the Pick: 3 h after the plan, or 24 h after the decision.
 */
export function shouldAskDidYouGo(
  plan: Pick<PlanSummary, 'planAt' | 'myOutcome' | 'myRsvp'>,
  decidedAt: string | null,
  now: Date = new Date(),
): boolean {
  if (plan.myOutcome || plan.myRsvp === 'not_going') return false;
  return attendanceDue(plan.planAt, decidedAt, now.getTime());
}

/** "3 of 4 went", once anyone has answered. */
export function wentSummary(
  plan: Pick<PlanSummary, 'outcomes' | 'participantCount'>,
): string | null {
  const answered = plan.outcomes.went + plan.outcomes.didNotGo;
  if (!answered) return null;
  return `${plan.outcomes.went} of ${plan.participantCount} went`;
}
