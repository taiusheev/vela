/**
 * The outlines a face's initial is drawn from: `glyphs.bin`, built from Noto Serif TC Bold by
 * `scripts/build-face-glyphs.py`, which documents the format. It holds the 5,401 common characters
 * of Big5 level 1, the Latin capitals and the digits; any other initial has no outline here.
 */

/** One step of an outline, in font units with y pointing up. */
export type GlyphCommand =
  | { readonly op: "move" | "line"; readonly to: Point }
  | { readonly op: "quad"; readonly control: Point; readonly to: Point }
  | { readonly op: "cubic"; readonly control1: Point; readonly control2: Point; readonly to: Point }
  | { readonly op: "close" };

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface FaceGlyphs {
  /** Font units per em, after the build's grid. */
  readonly unitsPerEm: number;
  /** The outline of one character, or null when the file has none for it. */
  outline(codePoint: number): readonly GlyphCommand[] | null;
}

const MAGIC = "VFG1";
const HEADER_BYTES = 10;

export function readFaceGlyphs(bytes: Uint8Array): FaceGlyphs {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== MAGIC) {
    throw new Error("face glyphs: not a VFG1 file");
  }
  const count = view.getUint32(4, true);
  const unitsPerEm = view.getUint16(8, true);
  const codePointsAt = HEADER_BYTES;
  const endsAt = codePointsAt + count * 4;
  const dataAt = endsAt + count * 4;
  if (dataAt > bytes.byteLength) throw new Error("face glyphs: file is cut short");

  const indexOf = (codePoint: number): number => {
    let low = 0;
    let high = count - 1;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      const found = view.getUint32(codePointsAt + middle * 4, true);
      if (found === codePoint) return middle;
      if (found < codePoint) low = middle + 1;
      else high = middle - 1;
    }
    return -1;
  };

  return {
    unitsPerEm,
    outline(codePoint) {
      const index = indexOf(codePoint);
      if (index < 0) return null;
      const start = index === 0 ? 0 : view.getUint32(endsAt + (index - 1) * 4, true);
      const end = view.getUint32(endsAt + index * 4, true);
      return decode(bytes.subarray(dataAt + start, dataAt + end));
    },
  };
}

function decode(data: Uint8Array): GlyphCommand[] {
  const commands: GlyphCommand[] = [];
  let at = 0;
  let x = 0;
  let y = 0;
  const varint = (): number => {
    let value = 0;
    let shift = 0;
    for (;;) {
      const byte = data[at++];
      if (byte === undefined) throw new Error("face glyphs: outline is cut short");
      value |= (byte & 0x7f) << shift;
      if (byte < 0x80) break;
      shift += 7;
    }
    return (value >>> 1) ^ -(value & 1);
  };
  const point = (): Point => {
    x += varint();
    y += varint();
    return { x, y };
  };
  while (at < data.length) {
    const op = data[at++];
    switch (op) {
      case 0:
        commands.push({ op: "move", to: point() });
        break;
      case 1:
        commands.push({ op: "line", to: point() });
        break;
      case 2: {
        const control = point();
        commands.push({ op: "quad", control, to: point() });
        break;
      }
      case 3: {
        const control1 = point();
        const control2 = point();
        commands.push({ op: "cubic", control1, control2, to: point() });
        break;
      }
      case 4:
        commands.push({ op: "close" });
        break;
      default:
        throw new Error(`face glyphs: unknown command ${String(op)}`);
    }
  }
  return commands;
}
