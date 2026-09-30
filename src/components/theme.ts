export const colors = {
  bg: '#0E0B12',
  card: '#1B1622',
  cardHi: '#251E2F',
  text: '#FFF7F0',
  muted: '#A99FB5',
  border: '#2E2638',
  primary: '#FF4F6D',
  primaryText: '#FFFFFF',
  yes: '#2BD98B',
  maybe: '#4DA3FF',
  no: '#FF4D6D',
  danger: '#FF9A9A',
  dangerBg: '#3A1620',
  infoBg: '#1E1A2B',
} as const;

/** The WTW "flame": used for CTAs, the wordmark and progress. */
export const flame = ['#FF3D71', '#FF7A45'] as const;
export const flameSoft = ['#FF3D7133', '#FF7A4533'] as const;

export const fonts = {
  medium: 'Poppins_500Medium',
  semibold: 'Poppins_600SemiBold',
  bold: 'Poppins_700Bold',
  black: 'Poppins_800ExtraBold',
} as const;

/** Minimum touch target (WCAG 2.5.5 / Material guidance is 44–48). */
export const MIN_TARGET = 48;

/** Demo group: seeded bot participants (see supabase/seed.sql) plus you. */
export const FRIENDS = [
  { name: 'Ava', color: '#FF7A45' },
  { name: 'Ben', color: '#4DA3FF' },
  { name: 'Cam', color: '#B57BFF' },
] as const;
