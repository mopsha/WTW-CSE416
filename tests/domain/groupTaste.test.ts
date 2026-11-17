import {
  decayedScore,
  groupTasteScore,
  memberTastesFrom,
  memberValue,
  tasteOrder,
  tasteTypeOf,
} from '@shared/domain/groupTaste.ts';

const none = { liked: [], disliked: [], learned: {} };

test('a place scores as its first own survey type', () => {
  expect(tasteTypeOf(['restaurant', 'sushi_restaurant', 'japanese_restaurant'])).toBe(
    'sushi_restaurant',
  );
  expect(tasteTypeOf(['restaurant'])).toBeNull();
  expect(tasteTypeOf(undefined)).toBeNull();
});

test('learned scores halve every 30 days and never grow', () => {
  const now = new Date('2026-12-01T00:00:00Z');
  expect(decayedScore(4, '2026-12-01T00:00:00Z', now)).toBe(4);
  expect(decayedScore(4, '2026-11-01T00:00:00Z', now)).toBeCloseTo(2);
  expect(decayedScore(-4, '2026-10-02T00:00:00Z', now)).toBeCloseTo(-1);
  // A clock-skewed future timestamp counts as "just now", not as growth.
  expect(decayedScore(4, '2027-01-01T00:00:00Z', now)).toBe(4);
  expect(decayedScore(4, 'not a date', now)).toBe(0);
});

test('explicit answers beat learned ones; learned is capped at ±1', () => {
  const member = {
    liked: ['cafe'],
    disliked: ['park'],
    learned: { cafe: -9, park: 9, zoo: 1.5, museum: -9 },
  };
  expect(memberValue(member, 'cafe')).toBe(1);
  expect(memberValue(member, 'park')).toBe(-1);
  expect(memberValue(member, 'zoo')).toBe(0.5);
  expect(memberValue(member, 'museum')).toBe(-1);
  expect(memberValue(member, 'bakery')).toBe(0);
});

test('group score is the average over everyone, unknown types score 0', () => {
  const a = { ...none, liked: ['cafe'] };
  const b = { ...none, disliked: ['cafe'] };
  const c = none;
  expect(groupTasteScore([a, b, c], 'cafe')).toBe(0);
  expect(groupTasteScore([a, c], 'cafe')).toBe(0.5);
  expect(groupTasteScore([a], null)).toBe(0);
  expect(groupTasteScore([], 'cafe')).toBe(0);
});

test('tasteOrder: no signal keeps the order; ties keep provider order; dislikes go last; nothing dropped', () => {
  const items = ['a', 'b', 'c', 'd', 'e'];
  expect(tasteOrder(items, () => 0, 4)).toEqual(items);
  const s: Record<string, number> = { a: -1, b: 0.5, c: 0.5, d: 0.9, e: 0.2 };
  // ceil(4 * 0.7) = 3 taste picks: d, then the b/c tie in provider order; then the rest in
  // provider order, except the disliked a goes last.
  expect(tasteOrder(items, (x) => s[x]!, 4)).toEqual(['d', 'b', 'c', 'e', 'a']);
  // No taste slots: still nothing dropped, only the disliked a moves to the back.
  expect(tasteOrder(items, (x) => s[x]!, 0)).toEqual(['b', 'c', 'd', 'e', 'a']);
});

test('memberTastesFrom maps rows per user, decays learning and ignores junk', () => {
  const now = new Date('2026-12-01T00:00:00Z');
  const tastes = memberTastesFrom(
    ['a', 'b', 'nobody'],
    [
      { id: 'a', discover_preferences: { types: ['cafe'], dislikedTypes: ['zoo'] } },
      { id: 'b', discover_preferences: { types: ['not_a_type'] } },
    ],
    [
      { user_id: 'b', place_type: 'cafe', score: 4, updated_at: '2026-11-01T00:00:00Z' },
      { user_id: 'b', place_type: 'casino', score: 9, updated_at: '2026-12-01T00:00:00Z' },
    ],
    now,
  );
  expect(tastes[0]).toEqual({ liked: ['cafe'], disliked: ['zoo'], learned: {} });
  expect(tastes[1]!.liked).toEqual([]);
  expect(tastes[1]!.learned.cafe).toBeCloseTo(2);
  expect(tastes[1]!.learned).not.toHaveProperty('casino');
  expect(tastes[2]).toEqual({ liked: [], disliked: [], learned: {} });
});
