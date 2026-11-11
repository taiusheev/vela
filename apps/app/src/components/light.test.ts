import { createRequire } from "node:module";
import { createElement, type ReactElement } from "react";

const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as {
  renderToStaticMarkup(element: ReactElement): string;
};

import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ View: "div", Image: "native-image" }));
vi.mock("react-native-svg", () => ({
  default: "svg",
  Path: "path",
  Rect: "rect",
  Defs: "defs",
  ClipPath: "clipPath",
  Image: "svg-image",
}));
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

it("updates an already mounted window when a photo is added, changed, removed or fails", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(createElement(Light, { state: "lit" }));
  });
  const images = () => renderer.root.findAll((node) => String(node.type) === "svg-image");
  expect(images()).toHaveLength(0);
  try {
    for (const photoUri of ["file:///parent-first.jpg", "file:///parent-new.jpg"]) {
      await act(async () => renderer.update(createElement(Light, { state: "lit", photoUri })));
      expect(images()[0]?.props.href).toEqual({ uri: photoUri });
      expect(images()[0]?.props.opacity).toBe(1);
      expect(renderer.root.findAllByType("rect")).toHaveLength(2);
    }
    await act(async () =>
      renderer.root.find((node) => String(node.type) === "native-image").props.onError(),
    );
    expect(images()).toHaveLength(0);
    await act(async () =>
      renderer.update(
        createElement(Light, { state: "resting", photoUri: "file:///recovered.jpg" }),
      ),
    );
    expect(images()[0]?.props.opacity).toBe(0.16);
    await act(async () => renderer.update(createElement(Light, { state: "lit", photoUri: null })));
    expect(images()).toHaveLength(0);
  } finally {
    await act(async () => renderer.unmount());
  }
});
