import { Platform } from "react-native";

/**
 * The Candle & Ink tokens, from design/design-system.md v3. Values live here once; nothing in the
 * app writes a colour or a size of its own.
 */

export interface Palette {
  bg: string;
  surface: string;
  surface2: string;
  ink: string;
  ink2: string;
  ink3: string;
  rule: string;
  light: string;
  lightDeep: string;
  lightSoft: string;
  action: string;
  actionSoft: string;
  error: string;
}

export const lightPalette: Palette = {
  bg: "#FBF7F0",
  surface: "#FFFFFF",
  surface2: "#F3EDE4",
  ink: "#1E1A16",
  ink2: "#5A534B",
  ink3: "#7A7267",
  rule: "#E8E1D6",
  light: "#E9A23B",
  lightDeep: "#C27612",
  lightSoft: "#FBEBCF",
  action: "#1F5C66",
  actionSoft: "#E1EEF0",
  error: "#B3261E",
};

export const darkPalette: Palette = {
  bg: "#1B1714",
  surface: "#26211D",
  surface2: "#302A25",
  ink: "#F3EDE4",
  ink2: "#B9B0A5",
  ink3: "#8F867B",
  rule: "#3A332C",
  light: "#E9A23B",
  lightDeep: "#F0B65A",
  lightSoft: "#3B2E19",
  action: "#7FC3CC",
  actionSoft: "#17383E",
  error: "#F28B82",
};

/** The 4 pt grid: 4, 8, 12, 16, 20, 24, 32, 40, 56, with 20 pt app margins. */
export const space = {
  xs: 4,
  s: 8,
  m: 12,
  l: 16,
  margin: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
  huge: 56,
} as const;

export const radius = {
  card: 16,
  sheet: 24,
  button: 14,
  parentButton: 22,
  chip: 999,
} as const;

export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing?: number;
}

/**
 * Inter and Literata have no Chinese characters. On the web a face is a CSS font stack, so each role
 * names Noto TC first, used wherever it is installed, then the platform's own Traditional Chinese
 * face (design system, Typography: Noto Serif TC for Voice and Titles, Noto Sans TC or PingFang TC
 * for the interface). Nothing is fetched from Google: the app contacts no third party on its own. A
 * phone takes one registered name per face and draws what it lacks from the system's CJK font,
 * chosen by the phone's own languages, so a stack would do nothing there (ADR-30).
 */
const SANS_TC =
  '"Noto Sans TC", "Noto Sans CJK TC", "PingFang TC", "Microsoft JhengHei", sans-serif';
const SERIF_TC = '"Noto Serif TC", "Noto Serif CJK TC", "Songti TC", "PMingLiU", serif';

function face(name: string, fallback: string): string {
  return Platform.OS === "web" ? `${name}, ${fallback}` : name;
}

/**
 * One serif moment per screen at most, and never a serif on a control: Literata carries people's
 * own words, Inter carries the interface.
 */
export const type = {
  display: { fontFamily: face("Literata_600SemiBold", SERIF_TC), fontSize: 34, lineHeight: 40 },
  title: { fontFamily: face("Literata_600SemiBold", SERIF_TC), fontSize: 26, lineHeight: 32 },
  voice: { fontFamily: face("Literata_400Regular", SERIF_TC), fontSize: 19, lineHeight: 27 },
  heading: { fontFamily: face("Inter_600SemiBold", SANS_TC), fontSize: 17, lineHeight: 24 },
  body: { fontFamily: face("Inter_400Regular", SANS_TC), fontSize: 17, lineHeight: 24 },
  bodyMedium: { fontFamily: face("Inter_500Medium", SANS_TC), fontSize: 17, lineHeight: 24 },
  button: { fontFamily: face("Inter_600SemiBold", SANS_TC), fontSize: 16, lineHeight: 20 },
  caption: { fontFamily: face("Inter_400Regular", SANS_TC), fontSize: 13, lineHeight: 18 },
  label: {
    fontFamily: face("Inter_600SemiBold", SANS_TC),
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.72,
  },
} satisfies Record<string, TextStyle>;

/** Card fades 240 ms, screens 300 ms, and the light blooms once over 600–900 ms. */
export const motion = {
  card: 240,
  screen: 300,
  lightBloom: 700,
} as const;

/** The one shadow in the system, under the quiet notice sheet only. */
export const sheetShadow = {
  shadowColor: "#1E1A16",
  shadowOpacity: 0.14,
  shadowRadius: 32,
  shadowOffset: { width: 0, height: 12 },
  elevation: 12,
} as const;

export const hitSlop = { top: 8, bottom: 8, left: 8, right: 8 } as const;
