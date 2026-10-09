/** Avatar background colors: readable with white initials on the dark theme. */
export const AVATAR_COLORS = [
  '#FF7A45',
  '#4DA3FF',
  '#B57BFF',
  '#2BB673',
  '#FF4F6D',
  '#E0A800',
  '#00A9B5',
] as const;

/** "Mike Opsha" -> "MO", "razin" -> "R", "" -> "?". */
export function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0]![0] ?? '';
  const last = words.length > 1 ? (words[words.length - 1]![0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** The same name always gets the same color (so a friend looks the same on every screen). */
export function colorForName(name: string): string {
  let hash = 0;
  for (const ch of name.trim().toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!;
}
