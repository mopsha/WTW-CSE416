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

// ponytail: presets instead of a date picker (none is installed); add
// @react-native-community/datetimepicker if testers want exact times.
/** A few one-tap times, all in the future, earliest first. */
export function planTimeOptions(now: Date = new Date()): { label: string; value: string }[] {
  const soon = new Date(now.getTime() + 60 * 60_000);
  soon.setMinutes(Math.ceil(soon.getMinutes() / 15) * 15, 0, 0);
  const options = [{ label: 'In about an hour', at: soon }];
  const tonight = at(now, 0, 20);
  if (tonight.getTime() - now.getTime() > 90 * 60_000) {
    options.push({ label: 'Tonight 8 PM', at: tonight });
  }
  options.push({ label: 'Tomorrow 7 PM', at: at(now, 1, 19) });
  const toSaturday = (6 - now.getDay() + 7) % 7;
  if (toSaturday >= 2) options.push({ label: 'Saturday 7 PM', at: at(now, toSaturday, 19) });
  return options.map((o) => ({ label: o.label, value: o.at.toISOString() }));
}

/** Ask once the plan time has passed, or 3 hours after the decision when no time was set. */
export function shouldAskDidYouGo(
  plan: Pick<PlanSummary, 'planAt' | 'myOutcome' | 'myRsvp'>,
  decidedAt: string | null,
  now: Date = new Date(),
): boolean {
  if (plan.myOutcome || plan.myRsvp === 'not_going') return false;
  if (plan.planAt) return now.getTime() >= Date.parse(plan.planAt);
  return decidedAt !== null && now.getTime() - Date.parse(decidedAt) >= 3 * 60 * 60_000;
}

/** "3 of 4 went", once anyone has answered. */
export function wentSummary(
  plan: Pick<PlanSummary, 'outcomes' | 'participantCount'>,
): string | null {
  const answered = plan.outcomes.went + plan.outcomes.didNotGo;
  if (!answered) return null;
  return `${plan.outcomes.went} of ${plan.participantCount} went`;
}
