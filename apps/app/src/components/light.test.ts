import { createRequire } from "node:module";
import { createElement, type ReactElement } from "react";

const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as {
  renderToStaticMarkup(element: ReactElement): string;
};

import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ View: "div" }));
vi.mock("react-native-svg", () => ({ default: "svg", Path: "path", Rect: "rect" }));
vi.mock("../theme/theme.tsx", () => ({
  usePalette: () => ({ light: "#E9A23B", surface2: "#F3EDE4", ink: "#1E1A16" }),
}));

import { Light } from "./light.tsx";

describe("the parent window", () => {
  it("keeps both crossbars when unlit, quiet, paused, away or lit, including small marks", () => {
    for (const state of ["resting", "quiet", "paused", "away", "lit"] as const) {
      for (const height of [16, 28, 44]) {
        const window = renderToStaticMarkup(createElement(Light, { state, height }));
        expect((window.match(/<rect /g) ?? []).length).toBe(2);
        expect(window.includes('fill="#E9A23B"')).toBe(state === "lit");
      }
    }
  });
});
