import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));

import { darkPalette, lightPalette } from "./tokens.ts";

// WCAG relative luminance, evaluated from actual token values rather than rounded ratios.
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return (channels[0] ?? 0) * 0.2126 + (channels[1] ?? 0) * 0.7152 + (channels[2] ?? 0) * 0.0722;
}

function contrast(first: string, second: string): number {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

for (const [scheme, palette] of Object.entries({ light: lightPalette, dark: darkPalette })) {
  describe(`${scheme} appearance legibility`, () => {
    for (const background of ["bg", "surface", "surface2", "lightSoft", "actionSoft"] as const) {
      for (const foreground of ["ink", "ink2", "ink3", "action"] as const) {
        it(`${foreground} text on ${background} meets 4.5:1`, () => {
          expect(contrast(palette[foreground], palette[background])).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
    it("primary button label meets 4.5:1", () => {
      expect(contrast(palette.onAction, palette.action)).toBeGreaterThanOrEqual(4.5);
    });
    for (const background of ["bg", "surface"] as const) {
      it(`control edges on ${background} meet 3:1`, () => {
        expect(contrast(palette.control, palette[background])).toBeGreaterThanOrEqual(3);
      });
    }
  });
}
