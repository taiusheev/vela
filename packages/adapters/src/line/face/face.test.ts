import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { faceColour, faceInitial, faceOf, facePath, parseFacePath } from "./face.ts";
import { readFaceGlyphs } from "./glyphs.ts";
import { FACE_COLOURS, FACE_SIZE, renderFace } from "./render.ts";

const glyphs = readFaceGlyphs(
  new Uint8Array(readFileSync(new URL("./glyphs.bin", import.meta.url))),
);

const cp = (character: string): number => character.codePointAt(0) ?? 0;

describe("faceInitial", () => {
  it("draws a Chinese name by its last character", () => {
    expect(faceInitial("小美")).toBe(cp("美"));
    expect(faceInitial("林小美")).toBe(cp("美"));
    expect(faceInitial("阿明 Ming")).toBe(cp("明"));
  });

  it("draws any other name by its first letter or digit, as a capital", () => {
    expect(faceInitial("timur")).toBe(cp("T"));
    expect(faceInitial("  Anna")).toBe(cp("A"));
    expect(faceInitial("Ｔｉｍ")).toBe(cp("T"));
  });

  it("gives none for a name with neither", () => {
    expect(faceInitial("🌸")).toBeNull();
    expect(faceInitial("   ")).toBeNull();
    expect(faceOf({ name: "Đ", memberId: "m" })).toBeNull();
  });
});

describe("faceColour", () => {
  it("keeps one colour per member, among the palette", () => {
    const ids = Array.from({ length: 40 }, (_, i) => `member-${i}`);
    for (const id of ids) {
      expect(faceColour(id)).toBe(faceColour(id));
      expect(faceColour(id)).toBeGreaterThanOrEqual(0);
      expect(faceColour(id)).toBeLessThan(FACE_COLOURS.length);
    }
    expect(new Set(ids.map(faceColour)).size).toBe(FACE_COLOURS.length);
  });
});

describe("facePath and parseFacePath", () => {
  it("read back the face a path names, and only the one spelling", () => {
    const face = { codePoint: cp("美"), colour: 2 };
    expect(facePath(face)).toBe("/faces/v1/7f8e-2.png");
    expect(parseFacePath("7f8e-2.png")).toStrictEqual(face);
    expect(parseFacePath("07f8e-2.png")).toBeNull();
    expect(parseFacePath("7F8E-2.png")).toBeNull();
    expect(parseFacePath("7f8e-9.png")).toBeNull();
    expect(parseFacePath("7f8e-2.jpg")).toBeNull();
    expect(parseFacePath("110000-0.png")).toBeNull();
  });
});

describe("renderFace", () => {
  it("holds the common Taiwan characters and the Latin capitals", () => {
    for (const character of ["美", "明", "媽", "婷", "華", "A", "Z", "7"]) {
      expect(glyphs.outline(cp(character)), character).not.toBeNull();
    }
    expect(glyphs.outline(cp("a"))).toBeNull();
  });

  it("draws the initial in white on a round disc of the member's colour", async () => {
    const png = await renderFace(glyphs, cp("美"), 1);
    if (png === null) throw new Error("no face");
    const pixels = await decodePng(png);
    expect(pixels.width).toBe(FACE_SIZE);
    expect(pixels.height).toBe(FACE_SIZE);
    // A corner is outside the disc.
    expect(pixels.at(1, 1)[3]).toBe(0);
    // Inside the disc, away from the character, is the colour.
    expect(pixels.at(FACE_SIZE / 2, 12)).toStrictEqual([...FACE_COLOURS[1], 255]);
    // Somewhere the character is white.
    let white = 0;
    for (let y = 0; y < FACE_SIZE; y++) {
      for (let x = 0; x < FACE_SIZE; x++) {
        const [r, g, b] = pixels.at(x, y);
        if (r === 255 && g === 255 && b === 255) white++;
      }
    }
    expect(white).toBeGreaterThan(1000);
  });

  it("gives the same bytes for the same face, and none for a character it does not hold", async () => {
    expect(await renderFace(glyphs, cp("美"), 0)).toStrictEqual(
      await renderFace(glyphs, cp("美"), 0),
    );
    expect(await renderFace(glyphs, cp("𠀀"), 0)).toBeNull();
  });
});

/** Reads back the one-IDAT, unfiltered RGBA PNG `encodePng` writes. */
async function decodePng(png: Uint8Array) {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const idatLength = view.getUint32(33);
  const idat = png.subarray(41, 41 + idatLength);
  const raw = new Uint8Array(
    await new Response(
      new Blob([idat]).stream().pipeThrough(new DecompressionStream("deflate")),
    ).arrayBuffer(),
  );
  return {
    width,
    height,
    at(x: number, y: number): number[] {
      const at = y * (width * 4 + 1) + 1 + x * 4;
      return Array.from(raw.subarray(at, at + 4));
    },
  };
}
