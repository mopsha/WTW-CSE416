// Groups in the app (Razin, M4). Reads come through RLS (src/lib/queries.ts: members only);
// writes go through the API (src/lib/api.ts, supabase/functions/_shared/api/groups.ts).
import { MAX_GROUP_NAME } from '@shared/api/groups.ts';

import type { PickSummary } from './types';

export { MAX_GROUP_NAME };

/** A row on the groups list. */
export interface GroupSummary {
  id: string;
  name: string;
  ownerId: string;
  isOwner: boolean;
  memberCount: number;
}

export interface GroupMember {
  userId: string;
  displayName: string | null;
  role: 'owner' | 'member';
}

export interface GroupDetail {
  id: string;
  name: string;
  ownerId: string;
  /** Owner first, then by name. */
  members: GroupMember[];
  /** Picks started for this group that I'm in (RLS), newest first. */
  picks: PickSummary[];
}

/** An accepted friend, for the "Add people" and "Invite" lists. */
export interface FriendOption {
  userId: string;
  displayName: string | null;
}

/** "Ava", or a stand-in for someone who hasn't picked a name yet. */
export const memberName = (m: { displayName: string | null }) =>
  m.displayName?.trim() || 'WTW friend';

export function sortMembers(members: GroupMember[]): GroupMember[] {
  return [...members].sort(
    (a, b) =>
      (a.role === 'owner' ? 0 : 1) - (b.role === 'owner' ? 0 : 1) ||
      memberName(a).localeCompare(memberName(b)),
  );
}

/** Friends who aren't in the group yet. */
export function addableFriends(friends: FriendOption[], members: GroupMember[]): FriendOption[] {
  const inGroup = new Set(members.map((m) => m.userId));
  return friends
    .filter((f) => !inGroup.has(f.userId))
    .sort((a, b) => memberName(a).localeCompare(memberName(b)));
}

/** Same rule as the API's parseGroupName: trimmed, 1–50 characters. Returns an error or null. */
export function groupNameProblem(name: string): string | null {
  const length = [...name.trim()].length;
  if (length === 0) return 'Give the group a name.';
  if (length > MAX_GROUP_NAME) return `Keep it to ${MAX_GROUP_NAME} characters.`;
  return null;
}

/** Subtitle for a group row. */
export function memberCountLabel(count: number): string {
  return count === 1 ? 'Just you' : `${count} people`;
}
