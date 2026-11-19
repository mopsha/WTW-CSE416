import type { PlanSummary, RsvpStatus } from '@shared/api/plans.ts';
import type { HangPost, HangStatus } from '@shared/api/hang.ts';

const countKey = (status: RsvpStatus) => (status === 'not_going' ? 'notGoing' : status);
export function projectPlanRsvp(plan: PlanSummary, desired: RsvpStatus): PlanSummary {
  if (plan.myRsvp === desired) return plan;
  const rsvps = { ...plan.rsvps };
  if (plan.myRsvp) rsvps[countKey(plan.myRsvp)] = Math.max(0, rsvps[countKey(plan.myRsvp)] - 1);
  rsvps[countKey(desired)]++;
  return { ...plan, myRsvp: desired, rsvps };
}
export const canRsvpPlan = (plan: PlanSummary) => ['completed', 'decided'].includes(plan.state);
export function projectHangRsvp(post: HangPost, desired: HangStatus): HangPost {
  const count = (status: HangStatus, current = 0) =>
    Math.max(0, current - Number(post.myStatus === status) + Number(desired === status));
  const attendees = post.attendees?.filter((person) => person.userId !== post.viewer?.userId);
  if (attendees && post.viewer && desired !== 'cant')
    attendees.unshift({ ...post.viewer, status: desired });
  return {
    ...post,
    ...(attendees ? { attendees } : {}),
    myStatus: desired,
    downCount: count('down', post.downCount),
    ...(post.maybeCount !== undefined ? { maybeCount: count('maybe', post.maybeCount) } : {}),
    ...(post.cantCount !== undefined ? { cantCount: count('cant', post.cantCount) } : {}),
  };
}
// A started Pick does not end the hang: the feed keeps it and the server still takes RSVPs.
export const canRsvpHang = (post: HangPost) => Date.parse(post.expiresAt) > Date.now();
