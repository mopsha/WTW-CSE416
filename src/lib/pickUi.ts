// Small pure helpers shared by the Pick screens (kept out of components so they're testable).
import type { Candidate, PickProgress, PickState } from './types';

export function pickTitle(category: string | null | undefined): string {
  return category === 'custom'
    ? 'Custom Plan'
    : category === 'activities'
      ? 'Activities Pick'
      : 'Food Pick';
}

export function pickEmoji(category: string | null | undefined): string {
  return category === 'custom' ? '✨' : category === 'activities' ? '🎳' : '🍜';
}

export const STATE_LABEL: Record<PickState, string> = {
  draft: 'In the lobby',
  swiping: 'Swiping now',
  ranking: 'Ranking',
  final_vote: 'Final vote',
  completed: 'Decided',
  canceled: 'Canceled',
};

/**
 * Directions to a place in the platform's maps app: Apple Maps on iOS, Google Maps elsewhere.
 * Uses coordinates when we have them, else searches the name and address.
 */
export function directionsUrl(
  place: Pick<Candidate, 'name' | 'address' | 'lat' | 'lng'>,
  os: string,
): string {
  const label = [place.name, place.address].filter(Boolean).join(', ');
  const hasPoint = place.lat !== null && place.lng !== null;
  if (os === 'ios') {
    const params = hasPoint
      ? `daddr=${place.lat},${place.lng}&q=${encodeURIComponent(place.name)}`
      : `daddr=${encodeURIComponent(label)}`;
    return `https://maps.apple.com/?${params}`;
  }
  const destination = hasPoint ? `${place.lat},${place.lng}` : encodeURIComponent(label);
  return `https://www.google.com/maps/dir/?api=1&destination=${destination}`;
}

/** "Ava, Ben and 2 others" style list of names. */
export function nameList(names: readonly string[], max = 3): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0]!;
  if (names.length <= max) return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  const rest = names.length - (max - 1);
  return `${names.slice(0, max - 1).join(', ')} and ${rest} others`;
}

/** The share text for a Pick's join code (Razin's wtw://join/CODE deep link). */
export function shareMessage(code: string): string {
  return `Help us decide on WTW! Join my Pick with code ${code} or tap wtw://join/${code}`;
}

/** Waiting-room line: "3 of 5 finished swiping" (counts only, never answers). */
export function progressLine(p: Pick<PickProgress, 'doneCount' | 'total'>): string {
  if (p.total > 0 && p.doneCount >= p.total) return 'Everyone’s done 🔥';
  return `${p.doneCount} of ${p.total} finished swiping`;
}

export function voteLine(p: Pick<PickProgress, 'votedCount' | 'total'>): string {
  if (p.total > 0 && p.votedCount >= p.total) return 'Everyone voted';
  return `${p.votedCount} of ${p.total} voted`;
}
