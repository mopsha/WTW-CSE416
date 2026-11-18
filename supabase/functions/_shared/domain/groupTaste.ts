// Group taste for Picks (owner: Alan). Spec: docs/taste-onboarding.md#pr-2.
// Pure TypeScript. Mirrors the decay in 0047_taste_learning.sql (private.learn_taste).

import { ACTIVITY_TYPE_OPTIONS, FOOD_TYPE_OPTIONS, readPreferences } from './preferences.ts';

/** The survey's place types: the only types WTW learns and scores. */
export const TASTE_TYPES: ReadonlySet<string> = new Set([
  ...FOOD_TYPE_OPTIONS.map((o) => o.value),
  ...ACTIVITY_TYPE_OPTIONS.map((o) => o.value),
]);

/** A learned score halves every 30 days without new signals, so tastes can change. */
export const HALF_LIFE_DAYS = 30;
/** A learned score this strong counts as much as an explicit like (or dislike, negated). */
export const LEARNED_FULL = 3;
/** Share of the provider deck chosen by group taste; the rest keeps the normal mix. */
export const TASTE_SHARE = 0.7;

const DAY_MS = 86_400_000;

/** The survey type a place teaches/scores as: its first own type that is a survey type. */
export function tasteTypeOf(types: readonly string[] | undefined): string | null {
  return types?.find((t) => TASTE_TYPES.has(t)) ?? null;
}

/** Learned scores stay within ±this, after fading. */
export const LEARNED_MAX = 10;

/** A stored learned score, faded by time since it was last updated, then capped. */
export function decayedScore(score: number, updatedAt: string, now: Date): number {
  const days = Math.max(0, now.getTime() - Date.parse(updatedAt)) / DAY_MS;
  if (!Number.isFinite(days)) return 0;
  const faded = score * 0.5 ** (days / HALF_LIFE_DAYS);
  return Math.max(-LEARNED_MAX, Math.min(LEARNED_MAX, faded));
}

/** One participant's taste: what they said, plus what WTW learned (already decayed). */
export interface MemberTaste {
  liked: readonly string[];
  disliked: readonly string[];
  learned: Readonly<Record<string, number>>;
}

/** Database rows → one MemberTaste per user, in `userIds` order (missing rows = no taste). */
export function memberTastesFrom(
  userIds: readonly string[],
  profiles: readonly { id: string; discover_preferences: unknown }[],
  learned: readonly { user_id: string; place_type: string; score: number; updated_at: string }[],
  now: Date,
): MemberTaste[] {
  return userIds.map((id) => {
    const p = readPreferences(profiles.find((row) => row.id === id)?.discover_preferences);
    const mine: Record<string, number> = {};
    for (const row of learned)
      if (row.user_id === id && TASTE_TYPES.has(row.place_type))
        mine[row.place_type] = decayedScore(row.score, row.updated_at, now);
    return { liked: p.types, disliked: p.dislikedTypes, learned: mine };
  });
}

/** -1 (skip) to 1 (love). Explicit answers always win; learned scores fill the gaps. */
export function memberValue(member: MemberTaste, type: string): number {
  if (member.liked.includes(type)) return 1;
  if (member.disliked.includes(type)) return -1;
  const learned = member.learned[type] ?? 0;
  return Math.max(-1, Math.min(1, learned / LEARNED_FULL));
}

/** -1 to 1: how much this group likes a place type, on average. 0 when unknown. */
export function groupTasteScore(members: readonly MemberTaste[], type: string | null): number {
  if (!type || !members.length) return 0;
  return members.reduce((sum, m) => sum + memberValue(m, type), 0) / members.length;
}

/**
 * Reorders provider results so about TASTE_SHARE of the first `take` slots go to the best group
 * matches; the rest keep their original (interleaved, varied) order, with disliked types last.
 * Nothing is removed. With
 * no taste signal at all, the order is unchanged.
 */
export function tasteOrder<T>(found: readonly T[], score: (item: T) => number, take: number): T[] {
  const scored = found.map((item, i) => ({ item, i, s: score(item) }));
  if (scored.every((x) => x.s === 0)) return [...found];
  const picks = Math.ceil(Math.max(0, take) * TASTE_SHARE);
  const best = [...scored]
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, picks);
  const rest = scored.filter((x) => !best.includes(x));
  // Variety keeps provider order, but places the group would rather skip go last.
  return [...best, ...rest.filter((x) => x.s >= 0), ...rest.filter((x) => x.s < 0)].map(
    (x) => x.item,
  );
}
