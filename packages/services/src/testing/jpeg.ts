/**
 * A JPEG small enough to write out by hand, shaped as a phone writes one: a JFIF header, the
 * tables, one baseline frame and one scan. It is not a picture anyone could decode, and need not
 * be, since the upload never decodes: `cleanJpeg` walks its markers, and these are the right ones.
 * What the upload and photo-ask tests send.
 */

export interface TestJpegOptions {
  readonly width?: number;
  readonly height?: number;
  /**
   * A comment segment, which cleaning drops: two photos that differ only here are the same photo
   * once kept, and so the same upload on a replay.
   */
  readonly comment?: string;
  /** The scan's bytes, which cleaning keeps: two photos that differ here are two photos. */
  readonly scan?: readonly number[];
}

function segment(marker: number, payload: readonly number[]): number[] {
  const size = payload.length + 2;
  return [0xff, marker, size >> 8, size & 0xff, ...payload];
}

export function testJpeg(options: TestJpegOptions = {}): Uint8Array<ArrayBuffer> {
  const width = options.width ?? 640;
  const height = options.height ?? 480;
  const comment =
    options.comment === undefined ? [] : Array.from(options.comment, (c) => c.charCodeAt(0) & 0xff);
  return Uint8Array.from([
    0xff,
    0xd8,
    ...segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...(options.comment === undefined ? [] : segment(0xfe, comment)),
    ...segment(0xdb, [0x00, ...Array.from({ length: 64 }, (_, index) => index + 1)]),
    ...segment(0xc0, [8, height >> 8, height & 0xff, width >> 8, width & 0xff, 1, 1, 0x11, 0]),
    ...segment(0xc4, [0x00, 1, ...Array<number>(15).fill(0), 0x00]),
    ...segment(0xda, [1, 1, 0x00, 0, 63, 0]),
    ...(options.scan ?? [0x12, 0x34, 0xff, 0x00, 0x56]),
    0xff,
    0xd9,
  ]);
}
