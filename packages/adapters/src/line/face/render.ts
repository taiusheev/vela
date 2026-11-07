/**
 * Draws a face: a family member's initial in white on a round coloured disc, as a PNG LINE shows
 * beside the messages that speak for them (`sender.iconUrl`). Plain TypeScript, with no image
 * library: the outline is cut into straight edges, filled by the nonzero rule on a grid four times
 * finer each way, and the coverage becomes the alpha of each pixel. The PNG's rows are compressed
 * with the platform's own `CompressionStream`, which Workers and Node both have.
 */
import type { FaceGlyphs, GlyphCommand, Point } from "./glyphs.ts";

/**
 * The disc's colours, one per family member by `faceColour`: amber, teal, rose and moss from the
 * brand palette, each dark enough for white text on it.
 */
export const FACE_COLOURS = [
  [0xc2, 0x7a, 0x22],
  [0x1f, 0x5c, 0x66],
  [0xa8, 0x52, 0x4f],
  [0x56, 0x71, 0x3f],
] as const;

/** LINE shows the icon at about 40 points; 240 pixels is sharp on any phone. */
export const FACE_SIZE = 240;

/** Samples per pixel along each axis. */
const SUPERSAMPLE = 4;
/** The initial's em as a share of the picture: a Han character fills about half of it. */
const EM_SHARE = 0.56;
/** Straight pieces each curve is cut into; plenty at this size. */
const CURVE_STEPS = 10;

interface Edge {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  /** +1 going down the picture, -1 going up. */
  readonly winding: 1 | -1;
}

/**
 * The PNG of one face, or null when the glyphs hold no outline for `codePoint`. The same input
 * always gives the same bytes.
 */
export async function renderFace(
  glyphs: FaceGlyphs,
  codePoint: number,
  colour: number,
): Promise<Uint8Array | null> {
  const outline = glyphs.outline(codePoint);
  if (outline === null) return null;
  const rgb = FACE_COLOURS[colour] ?? FACE_COLOURS[0];
  const size = FACE_SIZE;
  const glyph = coverage(placeOutline(outline, glyphs.unitsPerEm, size), size);
  const disc = discCoverage(size);
  const rgba = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const ink = glyph[i] ?? 0;
    rgba[i * 4] = Math.round(rgb[0] + (255 - rgb[0]) * ink);
    rgba[i * 4 + 1] = Math.round(rgb[1] + (255 - rgb[1]) * ink);
    rgba[i * 4 + 2] = Math.round(rgb[2] + (255 - rgb[2]) * ink);
    rgba[i * 4 + 3] = Math.round(255 * (disc[i] ?? 0));
  }
  return encodePng(size, size, rgba);
}

/**
 * The outline as edges in picture samples (y down), scaled to `EM_SHARE` of the picture and centred
 * on its own bounds, so a Han character and a Latin capital both sit in the middle of the disc.
 */
function placeOutline(outline: readonly GlyphCommand[], unitsPerEm: number, size: number): Edge[] {
  const polylines = flatten(outline);
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const line of polylines) {
    for (const p of line) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
  }
  if (!Number.isFinite(minX)) return [];
  const samples = size * SUPERSAMPLE;
  const scale = (EM_SHARE * samples) / unitsPerEm;
  const centreX = (minX + maxX) / 2;
  const centreY = (minY + maxY) / 2;
  const toSample = (p: Point): Point => ({
    x: samples / 2 + (p.x - centreX) * scale,
    y: samples / 2 - (p.y - centreY) * scale,
  });
  const edges: Edge[] = [];
  for (const line of polylines) {
    const points = line.map(toSample);
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      if (a === undefined || b === undefined || a.y === b.y) continue;
      edges.push(
        a.y < b.y
          ? { x0: a.x, y0: a.y, x1: b.x, y1: b.y, winding: 1 }
          : { x0: b.x, y0: b.y, x1: a.x, y1: a.y, winding: -1 },
      );
    }
  }
  return edges;
}

/** Each contour as a closed run of points, curves cut into straight pieces. */
function flatten(outline: readonly GlyphCommand[]): Point[][] {
  const contours: Point[][] = [];
  let current: Point[] = [];
  let at: Point = { x: 0, y: 0 };
  for (const command of outline) {
    switch (command.op) {
      case "move":
        if (current.length > 1) contours.push(current);
        current = [command.to];
        at = command.to;
        break;
      case "line":
        current.push(command.to);
        at = command.to;
        break;
      case "quad": {
        const from = at;
        for (let step = 1; step <= CURVE_STEPS; step++) {
          const t = step / CURVE_STEPS;
          const u = 1 - t;
          current.push({
            x: u * u * from.x + 2 * u * t * command.control.x + t * t * command.to.x,
            y: u * u * from.y + 2 * u * t * command.control.y + t * t * command.to.y,
          });
        }
        at = command.to;
        break;
      }
      case "cubic": {
        const from = at;
        for (let step = 1; step <= CURVE_STEPS; step++) {
          const t = step / CURVE_STEPS;
          const u = 1 - t;
          const a = u * u * u;
          const b = 3 * u * u * t;
          const c = 3 * u * t * t;
          const d = t * t * t;
          current.push({
            x: a * from.x + b * command.control1.x + c * command.control2.x + d * command.to.x,
            y: a * from.y + b * command.control1.y + c * command.control2.y + d * command.to.y,
          });
        }
        at = command.to;
        break;
      }
      case "close":
        if (current.length > 1) contours.push(current);
        current = [];
        break;
    }
  }
  if (current.length > 1) contours.push(current);
  return contours;
}

/** The share of each pixel's samples inside the outline, by the nonzero rule. */
function coverage(edges: readonly Edge[], size: number): Float32Array {
  const samples = size * SUPERSAMPLE;
  const counts = new Uint16Array(size * size);
  const crossings: { x: number; winding: number }[] = [];
  for (let row = 0; row < samples; row++) {
    const y = row + 0.5;
    crossings.length = 0;
    for (const edge of edges) {
      if (y < edge.y0 || y >= edge.y1) continue;
      const t = (y - edge.y0) / (edge.y1 - edge.y0);
      crossings.push({ x: edge.x0 + t * (edge.x1 - edge.x0), winding: edge.winding });
    }
    if (crossings.length < 2) continue;
    crossings.sort((a, b) => a.x - b.x);
    const pixelRow = Math.floor(row / SUPERSAMPLE) * size;
    let winding = 0;
    for (let i = 0; i < crossings.length - 1; i++) {
      const crossing = crossings[i];
      const next = crossings[i + 1];
      if (crossing === undefined || next === undefined) continue;
      winding += crossing.winding;
      if (winding === 0) continue;
      // The sample columns whose centres lie in [crossing.x, next.x).
      const first = Math.max(0, Math.ceil(crossing.x - 0.5));
      const last = Math.min(samples - 1, Math.ceil(next.x - 0.5) - 1);
      for (let column = first; column <= last; column++) {
        const pixel = pixelRow + Math.floor(column / SUPERSAMPLE);
        counts[pixel] = (counts[pixel] ?? 0) + 1;
      }
    }
  }
  const out = new Float32Array(size * size);
  const perPixel = SUPERSAMPLE * SUPERSAMPLE;
  for (let i = 0; i < out.length; i++) out[i] = (counts[i] ?? 0) / perPixel;
  return out;
}

/** The share of each pixel's samples inside the disc that fills the picture. */
function discCoverage(size: number): Float32Array {
  const out = new Float32Array(size * size);
  const centre = size / 2;
  const radius = size / 2;
  const perPixel = SUPERSAMPLE * SUPERSAMPLE;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let inside = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const dx = px + (sx + 0.5) / SUPERSAMPLE - centre;
          const dy = py + (sy + 0.5) / SUPERSAMPLE - centre;
          if (dx * dx + dy * dy <= radius * radius) inside++;
        }
      }
      out[py * size + px] = inside / perPixel;
    }
  }
  return out;
}

// PNG ----------------------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** An 8-bit RGBA PNG, every row unfiltered, compressed as one zlib stream. */
export async function encodePng(
  width: number,
  height: number,
  rgba: Uint8Array,
): Promise<Uint8Array> {
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  const compressed = new Uint8Array(
    await new Response(
      new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate")),
    ).arrayBuffer(),
  );
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", compressed),
    chunk("IEND", new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
