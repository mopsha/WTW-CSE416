// WTW design tokens. Use these (and the components in this folder) instead of raw values,
// so every screen shares one look: dark surfaces, the "flame" accent, Poppins type.

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

/** The WTW "flame" gradient: primary buttons, progress, the logo. */
export const flame = ['#FF3D71', '#FF7A45'] as const;

/** Loaded in app/_layout.tsx via @expo-google-fonts/poppins. */
export const fonts = {
  medium: 'Poppins_500Medium',
  semibold: 'Poppins_600SemiBold',
  bold: 'Poppins_700Bold',
  black: 'Poppins_800ExtraBold',
} as const;

/** Type scale (font size, line height). */
export const type = {
  title: { fontFamily: fonts.black, fontSize: 28, lineHeight: 34 },
  heading: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 26 },
  body: { fontFamily: fonts.medium, fontSize: 16, lineHeight: 22 },
  caption: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18 },
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 12, md: 18, lg: 24, pill: 999 } as const;

/** Minimum touch target: Apple HIG 44 pt (Material 48 dp). Every tappable kit element meets it. */
export const MIN_TARGET = 44;
