/**
 * A photo from the app, cleaned before Vela keeps it (ADR-33). The phone has already re-encoded it
 * as a JPEG, which drops most of what a camera writes into a file, but nothing promises that, so
 * the Worker enforces it: one linear walk over the JPEG's markers, with no decoding, which keeps
 * what a decoder needs to draw the picture the right way up and nothing that says where, when, or
 * on what it was taken.
 *
 * What is kept, exactly (an allow-list; every other marker is dropped):
 * - SOI, and at the end EOI, after which every byte is dropped: a Samsung or MPF trailer is a
 *   second image with its own Exif.
 * - A JFIF APP0, rebuilt rather than copied: version and density from the original, and a 0×0
 *   thumbnail, since the original's thumbnail can show the photo before it was cropped.
 * - The Exif Orientation, and nothing else of the Exif: an APP1 holding a TIFF header and an IFD0
 *   with that one entry, written only when the original says 2 to 8. A portrait photo from a phone
 *   is often stored sideways with Orientation 6, and would arrive sideways without it.
 * - An APP2 ICC profile (colour; its description can name the device, which ADR-33 accepts), and
 *   an APP14 Adobe segment (whether the colours are transformed).
 * - The tables and the frame: DQT, DHT, DRI, and one SOF0, SOF1 or SOF2 (baseline, extended,
 *   progressive), whose width and height are read.
 * - Each SOS with its entropy-coded data, byte for byte. Inside that data, FF00, the restart
 *   markers FFD0 to FFD7 and fill FFs belong to it; any other marker ends it and the walk goes on,
 *   which is how a progressive file's scans, and the tables between them, are reached.
 *
 * Dropped: every other APPn (Exif with its GPS, maker notes and thumbnail, XMP, MPF, Photoshop and
 * IPTC, and the rest), COM, DAC, DNL, DHP, EXP, JPG and JPGn.
 *
 * Refused: anything that is not a JPEG, and a JPEG whose frame is not SOF0, SOF1 or SOF2 (lossless,
 * arithmetic, hierarchical), as `jpeg_only`; a file that cannot be walked to its EOI as
 * `malformed`; and sizes Telegram will not send as a photo as `dimensions`.
 */

/**
 * The sizes a photo may have. Telegram's sendPhoto takes a width and height of at most 10000
 * together, each side at most 20 times the other; 4096 on the long side is Vela's own, well inside
 * that, since the phone sends at most 1600.
 */
export const MAX_PHOTO_SIDE = 4096;
export const MAX_PHOTO_ASPECT = 20;

export type JpegRefusal = "jpeg_only" | "malformed" | "dimensions";

export type CleanedJpeg =
  | { ok: true; bytes: Uint8Array<ArrayBuffer>; width: number; height: number }
  | { ok: false; reason: JpegRefusal };

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const TEM = 0x01;
const APP0 = 0xe0;
const APP1 = 0xe1;
const APP2 = 0xe2;
const APP14 = 0xee;
/** DQT, DHT and DRI: tables a decoder needs, copied as they are. */
const TABLES: ReadonlySet<number> = new Set([0xdb, 0xc4, 0xdd]);
/** Baseline, extended sequential and progressive Huffman frames: what phones and Telegram draw. */
const FRAMES: ReadonlySet<number> = new Set([0xc0, 0xc1, 0xc2]);
/** Every other frame: lossless, hierarchical, and the arithmetic-coded ones. */
const REFUSED_FRAMES: ReadonlySet<number> = new Set([
  0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

const JFIF = [0x4a, 0x46, 0x49, 0x46, 0x00]; // "JFIF\0"
const EXIF = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
const ICC_PROFILE = [0x49, 0x43, 0x43, 0x5f, 0x50, 0x52, 0x4f, 0x46, 0x49, 0x4c, 0x45, 0x00]; // "ICC_PROFILE\0"
const ADOBE = [0x41, 0x64, 0x6f, 0x62, 0x65]; // "Adobe"
const ORIENTATION_TAG = 0x0112;
const TIFF_SHORT = 3;

function refuse(reason: JpegRefusal): CleanedJpeg {
  return { ok: false, reason };
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) return false;
  for (let index = 0; index < prefix.length; index += 1) {
    if (bytes[index] !== prefix[index]) return false;
  }
  return true;
}

function byteAt(bytes: Uint8Array, index: number): number {
  return bytes[index] ?? 0;
}

/**
 * A standard 16-byte JFIF APP0 in place of the original: its version, density unit and density
 * values, and no thumbnail. A unit JFIF does not define becomes 0 (an aspect ratio only), and a
 * density of 0, which JFIF does not allow, becomes 1. Null when the original is too short to be a
 * JFIF header at all, which drops it.
 */
function rebuiltJfif(payload: Uint8Array): Uint8Array | null {
  if (payload.length < 14) return null;
  const units = byteAt(payload, 7) <= 2 ? byteAt(payload, 7) : 0;
  const x = (byteAt(payload, 8) << 8) | byteAt(payload, 9);
  const y = (byteAt(payload, 10) << 8) | byteAt(payload, 11);
  const densityX = x === 0 ? 1 : x;
  const densityY = y === 0 ? 1 : y;
  return Uint8Array.of(
    0xff,
    APP0,
    0x00,
    0x10,
    ...JFIF,
    byteAt(payload, 5),
    byteAt(payload, 6),
    units,
    densityX >> 8,
    densityX & 0xff,
    densityY >> 8,
    densityY & 0xff,
    0x00,
    0x00,
  );
}

/**
 * The Orientation in an Exif block's IFD0 (`tiff` is the block after "Exif\0\0"), in either byte
 * order, when it is 2 to 8; null for 1 (as stored), for none, and for anything that cannot be read,
 * since an Exif block too broken to read is dropped with the rest rather than refusing the photo.
 */
function orientationOf(tiff: Uint8Array): number | null {
  if (tiff.length < 8) return null;
  const little = tiff[0] === 0x49 && tiff[1] === 0x49; // "II"
  const big = tiff[0] === 0x4d && tiff[1] === 0x4d; // "MM"
  if (!little && !big) return null;
  const u16 = (at: number): number =>
    little
      ? byteAt(tiff, at) | (byteAt(tiff, at + 1) << 8)
      : (byteAt(tiff, at) << 8) | byteAt(tiff, at + 1);
  const u32 = (at: number): number =>
    little
      ? (byteAt(tiff, at) |
          (byteAt(tiff, at + 1) << 8) |
          (byteAt(tiff, at + 2) << 16) |
          (byteAt(tiff, at + 3) << 24)) >>>
        0
      : ((byteAt(tiff, at) << 24) |
          (byteAt(tiff, at + 1) << 16) |
          (byteAt(tiff, at + 2) << 8) |
          byteAt(tiff, at + 3)) >>>
        0;
  if (u16(2) !== 42) return null;
  const ifd = u32(4);
  if (ifd < 8 || ifd + 2 > tiff.length) return null;
  const entries = u16(ifd);
  for (let index = 0; index < entries; index += 1) {
    const entry = ifd + 2 + index * 12;
    if (entry + 12 > tiff.length) return null;
    if (u16(entry) === ORIENTATION_TAG) {
      if (u16(entry + 2) !== TIFF_SHORT || u32(entry + 4) !== 1) return null;
      const value = u16(entry + 8);
      return value >= 2 && value <= 8 ? value : null;
    }
  }
  return null;
}

/**
 * An APP1 that says only how to turn the picture: "Exif\0\0", a big-endian TIFF header, and an IFD0
 * with the one Orientation entry and no next IFD. 36 bytes, the same for every photo but for the
 * one value.
 */
function orientationOnlyExif(orientation: number): Uint8Array {
  return Uint8Array.of(
    0xff,
    APP1,
    0x00,
    0x22, // the segment's length: 2 + 6 + 8 + 2 + 12 + 4
    ...EXIF,
    0x4d,
    0x4d, // "MM"
    0x00,
    0x2a, // 42
    0x00,
    0x00,
    0x00,
    0x08, // IFD0 right after the header
    0x00,
    0x01, // one entry
    ORIENTATION_TAG >> 8,
    ORIENTATION_TAG & 0xff,
    0x00,
    TIFF_SHORT,
    0x00,
    0x00,
    0x00,
    0x01, // one value
    0x00,
    orientation,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00, // no next IFD
  );
}

function withinPhotoLimits(width: number, height: number): boolean {
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  return short > 0 && long <= MAX_PHOTO_SIDE && long <= MAX_PHOTO_ASPECT * short;
}

/**
 * The photo as Vela keeps it, and its width and height; or why it was refused. `input` is read and
 * never changed, and the bytes returned are a fresh buffer of exactly their own length.
 */
export function cleanJpeg(input: Uint8Array): CleanedJpeg {
  const length = input.length;
  if (length === 0 || (length === 1 && input[0] === 0xff)) return refuse("malformed");
  if (input[0] !== 0xff || input[1] !== SOI) return refuse("jpeg_only");

  const kept: Uint8Array[] = [];
  let jfif: Uint8Array | null = null;
  let orientation: number | null = null;
  let frame: { width: number; height: number } | null = null;
  let scans = 0;
  let at = 2;
  for (;;) {
    if (at >= length || input[at] !== 0xff) return refuse("malformed");
    while (at < length && input[at] === 0xff) at += 1;
    if (at >= length) return refuse("malformed");
    const marker = byteAt(input, at);
    at += 1;
    if (marker === EOI) {
      if (frame === null || scans === 0) return refuse("malformed");
      break;
    }
    if (marker === 0x00 || marker === SOI || (marker >= 0xd0 && marker <= 0xd7)) {
      return refuse("malformed");
    }
    if (marker === TEM) continue;
    if (REFUSED_FRAMES.has(marker)) return refuse("jpeg_only");
    if (at + 2 > length) return refuse("malformed");
    const size = (byteAt(input, at) << 8) | byteAt(input, at + 1);
    const end = at + size;
    if (size < 2 || end > length) return refuse("malformed");
    const segment = input.subarray(at - 2, end);
    const payload = input.subarray(at + 2, end);
    at = end;

    if (FRAMES.has(marker)) {
      if (frame !== null || payload.length < 6) return refuse("malformed");
      const components = byteAt(payload, 5);
      if (components === 0 || payload.length < 6 + components * 3) return refuse("malformed");
      const height = (byteAt(payload, 1) << 8) | byteAt(payload, 2);
      const width = (byteAt(payload, 3) << 8) | byteAt(payload, 4);
      if (!withinPhotoLimits(width, height)) return refuse("dimensions");
      frame = { width, height };
      kept.push(segment);
    } else if (TABLES.has(marker)) {
      kept.push(segment);
    } else if (marker === APP0) {
      if (jfif === null && startsWith(payload, JFIF)) jfif = rebuiltJfif(payload);
    } else if (marker === APP1) {
      if (orientation === null && startsWith(payload, EXIF)) {
        orientation = orientationOf(payload.subarray(EXIF.length));
      }
    } else if (marker === APP2) {
      if (startsWith(payload, ICC_PROFILE)) kept.push(segment);
    } else if (marker === APP14) {
      if (startsWith(payload, ADOBE)) kept.push(segment);
    } else if (marker === SOS) {
      if (frame === null) return refuse("malformed");
      kept.push(segment);
      // The entropy-coded data runs to the first FF that begins a marker of its own.
      let scan = end;
      for (;;) {
        const ff = input.indexOf(0xff, scan);
        if (ff === -1 || ff + 1 >= length) return refuse("malformed");
        const next = byteAt(input, ff + 1);
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
          scan = ff + 2;
        } else if (next === 0xff) {
          scan = ff + 1;
        } else {
          kept.push(input.subarray(end, ff));
          at = ff;
          break;
        }
      }
      scans += 1;
    }
    // Every other marker is dropped: its bytes are simply not copied.
  }
  if (frame === null) return refuse("malformed");

  const head: Uint8Array[] = [Uint8Array.of(0xff, SOI)];
  if (jfif !== null) head.push(jfif);
  if (orientation !== null) head.push(orientationOnlyExif(orientation));
  const parts = [...head, ...kept, Uint8Array.of(0xff, EOI)];
  let total = 0;
  for (const part of parts) total += part.length;
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return { ok: true, bytes, width: frame.width, height: frame.height };
}
