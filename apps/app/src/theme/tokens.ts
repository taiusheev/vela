import { Platform } from "react-native";

/**
 * Shared Kept Light tokens, taken from the logo: its warm ink outline and its amber window. Actions
 * are the ink's espresso, the light is amber, and nothing is teal, which the logo never had (founder,
 * 21 Oct 2026). Modern task hierarchy is documented in design/modern-practical-research.md.
 */

export interface Palette {
  bg: string;
  surface: string;
  surface2: string;
  ink: string;
  ink2: string;
  ink3: string;
  rule: string;
  control: string;
  light: string;
  lightDeep: string;
  /** Amber for words, such as a memory's label: dark enough to read at small sizes (4.5:1). */
  lightInk: string;
  lightSoft: string;
  action: string;
  onAction: string;
  actionSoft: string;
  error: string;
}

export const lightPalette: Palette = {
  bg: "#FBF7F0",
  surface: "#FFFDF9",
  surface2: "#F3EDE4",
  ink: "#1E1A16",
  ink2: "#5A534B",
  ink3: "#6D655B",
  rule: "#E8E1D6",
  control: "#948779",
  light: "#E9A23B",
  lightDeep: "#C27612",
  lightInk: "#9A5A08",
  lightSoft: "#FBEBCF",
  action: "#3A2A1F",
  onAction: "#FFF8EE",
  actionSoft: "#F3E8D8",
  error: "#B3261E",
};

export const darkPalette: Palette = {
  bg: "#1B1714",
  surface: "#26211D",
  surface2: "#302A25",
  ink: "#F3EDE4",
  ink2: "#B9B0A5",
  ink3: "#A79B8D",
  rule: "#3A332C",
  control: "#8F867B",
  light: "#E9A23B",
  lightDeep: "#F0B65A",
  lightInk: "#F0B65A",
  lightSoft: "#3B2E19",
  // At night, buttons are warm paper on the dark room; amber is kept for a lit window and a heart,
  // so the light still means "she answered" (design review, 24 Oct 2026).
  action: "#EFE5D8",
  onAction: "#1B1714",
  actionSoft: "#332B24",
  error: "#F28B82",
};

/** The 4 pt grid: 4, 8, 12, 16, 20, 24, 32, 40, 56, with 24 pt app margins. */
export const space = {
  xs: 4,
  s: 8,
  m: 12,
  l: 16,
  margin: 24,
  xl: 24,
  xxl: 32,
  xxxl: 40,
  huge: 56,
} as const;

/**
 * Every page reads as one phone-width column. On an iPad the column stays centred instead of
 * stretching her words into one long line; a phone is never this wide, so it changes nothing there.
 */
export const readingColumn = 640;

export const radius = {
  card: 10,
  sheet: 24,
  button: 10,
  parentButton: 10,
  chip: 24,
  /** Today's cards and switcher, softer than a list card, after the founder's chosen prototype. */
  panel: 20,
} as const;

export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing?: number;
}

/**
 * Inter and Literata have no Chinese characters. Her words and the titles are set in a book face in
 * both languages, so Vela ships one Noto Serif TC weight cut to everyday Traditional Chinese (Big5
 * common characters and punctuation, about 6,300 glyphs, `assets/fonts/NotoSerifTC-Voice.ttf`). On
 * the web a face is a CSS font stack, so Literata draws the Latin letters and the Chinese serif the
 * rest. A phone takes one registered name per face, so in Chinese the book roles use the Chinese
 * serif outright, whose Latin letters are a serif too; a rare character it lacks falls back to the
 * phone's own Chinese face. Nothing is fetched from Google: the app contacts no third party (ADR-30).
 */
const SANS_TC =
  '"Noto Sans TC", "Noto Sans CJK TC", "PingFang TC", "Microsoft JhengHei", sans-serif';
export const SERIF_TC = "NotoSerifTC_Voice";

function face(name: string, fallback: string): string {
  return Platform.OS === "web" ? `${name}, ${fallback}` : name;
}

let chineseBookFace = false;

/** Set when the app's language changes; the book roles below read it each time they are drawn. */
export function setChineseBookFace(on: boolean): void {
  chineseBookFace = on;
}

function book(name: string): string {
  if (Platform.OS === "web") return `${name}, ${SERIF_TC}, ${SANS_TC}`;
  return chineseBookFace ? SERIF_TC : name;
}

/**
 * Conversation-first hierarchy: family words and titles in a book face; controls in Inter. The book
 * roles name their face through a getter, so a change of language reaches the next drawing.
 */
export const type = {
  display: {
    get fontFamily() {
      return book("Literata_500Medium");
    },
    fontSize: 34,
    lineHeight: 42,
  },
  title: {
    get fontFamily() {
      return book("Literata_500Medium");
    },
    fontSize: 28,
    lineHeight: 36,
  },
  voice: {
    get fontFamily() {
      return book("Literata_400Regular");
    },
    fontSize: 27,
    lineHeight: 40,
  },
  story: {
    get fontFamily() {
      return book("Literata_400Regular");
    },
    fontSize: 20,
    lineHeight: 34,
  },
  preview: {
    get fontFamily() {
      return book("Literata_400Regular");
    },
    fontSize: 20,
    lineHeight: 30,
  },
  heading: { fontFamily: face("Inter_600SemiBold", SANS_TC), fontSize: 17, lineHeight: 24 },
  body: { fontFamily: face("Inter_400Regular", SANS_TC), fontSize: 17, lineHeight: 24 },
  bodyMedium: { fontFamily: face("Inter_500Medium", SANS_TC), fontSize: 17, lineHeight: 24 },
  button: { fontFamily: face("Inter_600SemiBold", SANS_TC), fontSize: 15, lineHeight: 20 },
  caption: { fontFamily: face("Inter_400Regular", SANS_TC), fontSize: 14, lineHeight: 20 },
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

/**
 * Today's cards rest on the page with this one, low and wide and tinted from the ink, so they read
 * as paper laid on paper rather than floating. Dark mode draws no shadow: its rule carries the edge.
 */
export const softShadow = {
  shadowColor: "#6B4A2B",
  shadowOpacity: 0.1,
  shadowRadius: 24,
  shadowOffset: { width: 0, height: 10 },
  elevation: 3,
} as const;

/** Under the lit room on Today: deeper and warmer, as a lamp-lit window sits on a wall. */
export const roomShadow = {
  shadowColor: "#4A2E14",
  shadowOpacity: 0.28,
  shadowRadius: 32,
  shadowOffset: { width: 0, height: 16 },
  elevation: 8,
} as const;

/** The sheet's shadow, under the quiet notice only. */
export const sheetShadow = {
  shadowColor: "#1E1A16",
  shadowOpacity: 0.14,
  shadowRadius: 32,
  shadowOffset: { width: 0, height: 12 },
  elevation: 12,
} as const;

export const hitSlop = { top: 8, bottom: 8, left: 8, right: 8 } as const;

/** For a one-line text link (about 20 pt tall): reaches the 44 pt a finger needs without new space. */
export const linkHitSlop = { top: 12, bottom: 12, left: 8, right: 8 } as const;
