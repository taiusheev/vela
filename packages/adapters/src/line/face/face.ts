/**
 * Who a face is: the initial drawn and the colour behind it. A message that speaks for a family
 * member (`OutboundMessage.from`) goes on LINE under their name and this face, so a parent sees at a
 * glance that the morning question is her daughter's (LINE's `sender`, 05 §5.5).
 */
import { FACE_COLOURS } from "./render.ts";

export interface Face {
  readonly codePoint: number;
  /** An index into `FACE_COLOURS`. */
  readonly colour: number;
}

const HAN = /\p{Script=Han}/u;
const LATIN_OR_DIGIT = /[A-Za-z0-9]/;

/**
 * The character a name is drawn as: a Chinese name by its last character, as families call 小美
 * 美 and 阿明 明; any other name by its first Latin letter or digit, as a capital. Null for a name
 * with neither.
 */
export function faceInitial(name: string): number | null {
  const characters = Array.from(name.normalize("NFKC"));
  const han = characters.filter((character) => HAN.test(character));
  const last = han[han.length - 1];
  if (last !== undefined) return last.codePointAt(0) ?? null;
  const letter = characters.find((character) => LATIN_OR_DIGIT.test(character));
  return letter === undefined ? null : (letter.toUpperCase().codePointAt(0) ?? null);
}

/**
 * The colour a family member keeps on every message: their id hashed (FNV-1a), so it never changes
 * and two members of one family most often differ.
 */
export function faceColour(memberId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < memberId.length; i++) {
    hash ^= memberId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % FACE_COLOURS.length;
}

/** The face of a family member, or null when their name gives no initial. */
export function faceOf(person: { readonly name: string; readonly memberId: string }): Face | null {
  const codePoint = faceInitial(person.name);
  return codePoint === null ? null : { codePoint, colour: faceColour(person.memberId) };
}

/**
 * The path the pilot Worker serves a face at, below its origin. `v1` names this drawing: a new
 * style takes a new version, since LINE and phones keep the old picture for an old URL.
 */
export function facePath(face: Face): string {
  return `/faces/v1/${face.codePoint.toString(16)}-${face.colour}.png`;
}

/** The face a path names, or null for any path `facePath` does not make. */
export function parseFacePath(file: string): Face | null {
  const match = /^([0-9a-f]{1,6})-([0-9])\.png$/.exec(file);
  if (match === null) return null;
  const codePoint = Number.parseInt(match[1] ?? "", 16);
  const colour = Number(match[2]);
  if (colour >= FACE_COLOURS.length || codePoint > 0x10ffff) return null;
  // Only the one spelling `facePath` makes, so a picture has one URL.
  return facePath({ codePoint, colour }) === `/faces/v1/${file}` ? { codePoint, colour } : null;
}
