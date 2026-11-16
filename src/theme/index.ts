import { TextStyle } from 'react-native';

/**
 * Warm, quiet palette: mood colors appear only where a mood is being shown, and everything else sits on warm neutrals.
 * One light sage brand color, used sparingly.
 */
export const colors = {
  bg: '#faf6ee',
  surface: '#fffdf8',
  surface2: '#f2ece1',
  ink: '#3a322b',
  ink2: '#6f6559',
  ink3: '#a2978a',
  primary: '#8dbb9f',
  /** Dark text on a `primary` fill, since the sage is light. */
  onPrimary: '#2f3a33',
  primarySoft: '#e4efe8',
  /** Text-safe sage for links, ghost-button labels and the selected label. */
  primaryDeep: '#4f8264',
  teal: '#4f8264',
  tealSoft: '#e4efe8',
  amber: '#a9702c',
  amberSoft: '#f8ead6',
  rose: '#a4527c',
  roseSoft: '#f6e2ec',
  indigo: '#5a5fb0',
  indigoSoft: '#e9e9f7',
  violet: '#8056a8',
  violetSoft: '#f0e8f7',
  line: '#e9e1d4',
  /**
   * Mood scale: `deep` is text-safe, `mid` is the marker fill, `soft` is the tint behind a chip.
   * The same values are hard-coded in community/aggregate.ts, so keep them in sync.
   */
  mood: {
    calm: { deep: '#3f7d63', mid: '#9ccbb0', soft: '#e4f2ea' },
    good: { deep: '#8a6a12', mid: '#f0d27a', soft: '#fbf1cf' },
    stressed: { deep: '#b25f3a', mid: '#f2b592', soft: '#fbe6da' },
    low: { deep: '#5d67a3', mid: '#adb6de', soft: '#e9ebf6' },
    tired: { deep: '#7a6a8a', mid: '#c9b8d8', soft: '#f1ebf6' },
  },
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 12,
  md: 16,
  lg: 20,
  pill: 999,
} as const;

export const type = {
  title: { fontSize: 22, fontWeight: '700' } satisfies TextStyle,
  h2: { fontSize: 17, fontWeight: '600' } satisfies TextStyle,
  body: { fontSize: 15, fontWeight: '400' } satisfies TextStyle,
  sub: { fontSize: 13, fontWeight: '400' } satisfies TextStyle,
  caption: { fontSize: 11, fontWeight: '500' } satisfies TextStyle,
} as const;

export type ThemeColors = typeof colors;
export type ThemeSpacing = typeof spacing;
export type ThemeRadius = typeof radius;
export type ThemeType = typeof type;
