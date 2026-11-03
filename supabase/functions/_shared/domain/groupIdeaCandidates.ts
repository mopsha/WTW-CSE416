import type { GroupIdea } from '../api/groupIdeas.ts';
import type { Candidate, Category } from '../places/types.ts';
import type { LatLng } from './geo.ts';
import type { PickCategory } from './createPick.ts';

/** Provider filters intentionally do not apply to group-authored, coordinate-free ideas. */
export function groupIdeaCategory(
  category: PickCategory,
  mixCategory?: Category,
): Category | undefined {
  return category === 'both' ? undefined : category === 'custom' ? mixCategory : category;
}

export function groupIdeaCandidates(
  ideas: readonly GroupIdea[],
  groupId: string,
  category: Category | undefined,
  center: LatLng,
  uuid: () => string,
): Candidate[] {
  return ideas
    .filter(
      (idea) =>
        idea.groupId === groupId &&
        (!category || (idea.category === 'activity' ? 'activities' : 'food') === category),
    )
    .map((idea) => ({
      placeId: `custom:${uuid()}`,
      name: idea.name,
      category: idea.category === 'activity' ? 'activities' : 'food',
      provider: 'custom',
      source: 'custom',
      origin: 'group_idea',
      groupIdeaId: idea.id,
      groupId: idea.groupId,
      createdBy: idea.createdBy,
      ...(idea.description ? { note: idea.description } : {}),
      ...(idea.locationText ? { address: idea.locationText } : {}),
      // Reuse legacy coordinate-free custom semantics for the numeric ranking/DB contract.
      // This is a neutral tie-break point, never a real location. Clients expose null coords.
      lat: center.lat,
      lng: center.lng,
      locationProvided: false,
      retention: 'persistable',
    }));
}

/** Keep typed options; alternate ordinary candidates/ideas within the configured deck bound.
 * An idea gets the first available slot; ordinary candidates follow.
 * Stable input order (newest idea then UUID) determines which ideas fit; no second scoring system.
 */
export function mixGroupIdeaCandidates<T extends { placeId: string }>(
  base: T[],
  ideas: T[],
  limit: number,
  typedCount = 0,
): T[] {
  const fixed = base.slice(0, typedCount);
  const rest = base.slice(typedCount);
  const mixed: T[] = [];
  for (let i = 0; i < Math.max(rest.length, ideas.length); i++) {
    if (ideas[i]) mixed.push(ideas[i]!);
    if (rest[i]) mixed.push(rest[i]!);
  }
  // An idea gets the first free slot, then alternate public candidates with further ideas.
  const unique = new Map<string, T>();
  for (const candidate of [...fixed, ...mixed])
    if (!unique.has(candidate.placeId)) unique.set(candidate.placeId, candidate);
  return [...unique.values()].slice(0, limit);
}

/** Existing provider category calls stay separate; a Both Pick round-robins their results. */
export function providerCategories(category: PickCategory, mixCategory?: Category): Category[] {
  if (category === 'both') return ['food', 'activities'];
  const single = groupIdeaCategory(category, mixCategory);
  return single ? [single] : [];
}
export function interleaveCandidates<T>(lists: T[][]): T[] {
  const result: T[] = [];
  for (let i = 0; i < Math.max(0, ...lists.map((list) => list.length)); i++)
    for (const list of lists) if (i < list.length) result.push(list[i]!);
  return result;
}
