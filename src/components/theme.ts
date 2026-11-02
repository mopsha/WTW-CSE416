// WTW design tokens. Use these (and the components in this folder) instead of raw values,
// so every screen shares one look: neutral dark surfaces, the coral accent, Poppins type.

export const colors = {
  bg: '#0C0C0E',
  card: '#1B1B1E',
  cardHi: '#262629',
  text: '#F6F5F2',
  muted: '#AAA8AE',
  border: '#303034',
  primary: '#FF4F6D',
  primaryText: '#FFFFFF',
  yes: '#2BD98B',
  maybe: '#4DA3FF',
  no: '#FF4D6D',
  danger: '#FF9A9A',
  dangerBg: '#30181E',
  infoBg: '#19191C',
  scrim: 'rgba(0,0,0,0.6)',
  photoShade: 'rgba(0,0,0,0.88)',
  photoText: '#FFFFFF',
  photoMuted: '#E0DDDA',
  transparent: 'transparent',
} as const;

/** Compatibility tuples for existing callers; primary actions now use solid coral. */
export const flame = [colors.primary, colors.primary] as const;
export const flameSoft = ['#FF4F6D20', '#FF4F6D20'] as const;

/** Loaded in app/_layout.tsx via @expo-google-fonts/poppins. */
export const fonts = {
  regular: 'Poppins_400Regular',
  medium: 'Poppins_500Medium',
  semibold: 'Poppins_600SemiBold',
  bold: 'Poppins_700Bold',
  black: 'Poppins_800ExtraBold',
} as const;

/** Type scale (font size, line height). */
export const type = {
  title: { fontFamily: fonts.bold, fontSize: 32, lineHeight: 40 },
  heading: { fontFamily: fonts.semibold, fontSize: 20, lineHeight: 28 },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 22 },
  caption: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 10, md: 14, lg: 22, pill: 999 } as const;

/** Minimum touch target: Apple HIG 44 pt (Material 48 dp). Every tappable kit element meets it. */
export const MIN_TARGET = 44;

/** Demo group: seeded bot participants (see supabase/seed.sql) plus you. */
export const FRIENDS = [
  { name: 'Ava', color: '#FF7A45' },
  { name: 'Ben', color: '#4DA3FF' },
  { name: 'Cam', color: '#B57BFF' },
] as const;

/** Shared tab geometry: neutral rows, controls and photo treatments. */
export const surfaces = {
  line: { borderBottomWidth: 1, borderBottomColor: colors.border },
  control: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
} as const;
