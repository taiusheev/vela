/**
 * `cleanJpeg` on JPEGs built byte by byte here, so each test says exactly which segment it is about.
 * The tables and scans are the right shape rather than a picture anyone could decode: the cleaner
 * never decodes, and what it must promise is that it copies them unchanged.
 */
import { describe, expect, it } from "vitest";
import { cleanJpeg, MAX_PHOTO_ASPECT, MAX_PHOTO_SIDE } from "./media-jpeg.ts";

const ascii = (text: string): number[] => Array.from(text, (character) => character.charCodeAt(0));

function concat(...parts: (Uint8Array | readonly number[])[]): Uint8Array {
  const arrays = parts.map((part) => (part instanceof Uint8Array ? part : Uint8Array.from(part)));
  const out = new Uint8Array(arrays.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of arrays) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** One marker segment: FF, the marker, the big-endian length (itself included), the payload. */
function segment(marker: number, payload: readonly number[] | Uint8Array): Uint8Array {
  const size = payload.length + 2;
  return concat([0xff, marker, size >> 8, size & 0xff], payload);
}

const SOI = [0xff, 0xd8];
const EOI = [0xff, 0xd9];

function frame(marker: number, width: number, height: number): Uint8Array {
  return segment(marker, [
    8,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    3,
    ...[1, 0x22, 0],
    ...[2, 0x11, 1],
    ...[3, 0x11, 1],
  ]);
}

const DQT = segment(0xdb, [0x00, ...Array.from({ length: 64 }, (_, index) => index + 1)]);
const DHT = segment(0xc4, [0x00, 1, ...Array<number>(15).fill(0), 0x00]);
const DHT_AC = segment(0xc4, [0x10, 1, ...Array<number>(15).fill(0), 0x01]);
const DRI = segment(0xdd, [0x00, 0x10]);
const SOS = segment(0xda, [3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0]);
const SOS_AC = segment(0xda, [1, 1, 0x00, 1, 63, 0]);
/** Entropy-coded data with a stuffed FF00, a restart marker, and fill bytes before the end. */
const DATA = [0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd3, 0x78, 0x9a, 0xff, 0xff];
const DATA_2 = [0xab, 0xff, 0x00, 0xcd, 0xef];

const JFIF_WITH_THUMBNAIL = segment(0xe0, [
  ...ascii("JFIF\0"),
  1,
  2,
  1, // dots per inch
  0,
  72,
  0,
  72,
  2,
  1, // a 2×1 thumbnail
  ...[0xde, 0xad, 0xbe, 0xef, 0xca, 0xfe],
]);
/** The JFIF APP0 the cleaner writes in its place: the same version and density, no thumbnail. */
const JFIF_REBUILT = segment(0xe0, [...ascii("JFIF\0"), 1, 2, 1, 0, 72, 0, 72, 0, 0]);

const ICC = segment(0xe2, [...ascii("ICC_PROFILE\0"), 1, 1, ...ascii("desc sRGB IEC61966-2.1")]);
const MPF = segment(0xe2, [...ascii("MPF\0"), ...ascii("MM"), 0, 42, 0, 0, 0, 8]);
const XMP = segment(0xe1, [
  ...ascii("http://ns.adobe.com/xap/1.0/\0"),
  ...ascii("<x:xmpmeta><exif:GPSLatitude>25,2.1N</exif:GPSLatitude></x:xmpmeta>"),
]);
const PHOTOSHOP = segment(0xed, [...ascii("Photoshop 3.0\0"), ...ascii("8BIM caption: at home")]);
const COMMENT = segment(0xfe, ascii("shot on a SecretPhone 12"));
const ADOBE = segment(0xee, [...ascii("Adobe"), 0, 100, 0, 0, 0, 0, 1]);
const APP14_OTHER = segment(0xee, ascii("NotAdobe"));
const APP3 = segment(0xe3, ascii("META something"));
const APP15 = segment(0xef, ascii("vendor"));

type Endian = "II" | "MM";

/** An IFD entry: tag, type, count, and a value that fits in its four bytes. */
interface Entry {
  readonly tag: number;
  readonly type: number;
  readonly count: number;
  readonly value: readonly number[];
}

function u16(value: number, endian: Endian): number[] {
  return endian === "II" ? [value & 0xff, value >> 8] : [value >> 8, value & 0xff];
}

function u32(value: number, endian: Endian): number[] {
  const big = [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
  return endian === "II" ? big.reverse() : big;
}

/**
 * An Exif APP1 as a camera writes one: IFD0 with the given entries and, after it, the maker's name,
 * a GPS IFD with latitude and longitude, and a thumbnail's worth of bytes.
 */
function exif(endian: Endian, entries: readonly Entry[], tail: readonly number[] = []): Uint8Array {
  const ifd0 = 8;
  const afterIfd0 = ifd0 + 2 + entries.length * 12 + 4;
  const body = [
    ...ascii(endian),
    ...u16(42, endian),
    ...u32(ifd0, endian),
    ...u16(entries.length, endian),
    ...entries.flatMap((entry) => [
      ...u16(entry.tag, endian),
      ...u16(entry.type, endian),
      ...u32(entry.count, endian),
      ...entry.value,
      ...Array<number>(4 - entry.value.length).fill(0),
    ]),
    ...u32(0, endian),
  ];
  expect(body.length).toBe(afterIfd0);
  return segment(0xe1, [...ascii("Exif\0\0"), ...body, ...tail]);
}

const MAKE_AND_GPS: readonly number[] = [
  ...ascii("SecretPhone\0"),
  ...ascii("GPS 25.0330 N 121.5654 E"),
  ...Array<number>(32).fill(0x55),
];

function orientation(value: number, endian: Endian): Entry {
  return { tag: 0x0112, type: 3, count: 1, value: u16(value, endian) };
}

function camera(endian: Endian, extra: readonly Entry[] = []): Entry[] {
  return [
    // Make, pointing past IFD0 at "SecretPhone".
    { tag: 0x010f, type: 2, count: 12, value: u32(8 + 2 + (extra.length + 2) * 12 + 4, endian) },
    ...extra,
    // The GPS IFD's offset.
    { tag: 0x8825, type: 4, count: 1, value: u32(200, endian) },
  ];
}

/** The APP1 the cleaner writes for an orientation: big-endian, one entry, nothing else. */
function orientationOnly(value: number): Uint8Array {
  return segment(0xe1, [
    ...ascii("Exif\0\0"),
    ...ascii("MM"),
    0,
    42,
    0,
    0,
    0,
    8,
    0,
    1,
    0x01,
    0x12,
    0,
    3,
    0,
    0,
    0,
    1,
    0,
    value,
    0,
    0,
    0,
    0,
    0,
    0,
  ]);
}

/** A second image after EOI, as Samsung phones and MPF files carry one, with its own Exif. */
const TRAILER = concat(
  SOI,
  exif("II", camera("II"), MAKE_AND_GPS),
  frame(0xc0, 160, 120),
  SOS,
  [0x01, 0x02],
  EOI,
);

/** A phone's JPEG with everything a phone might write into it. */
function phoneJpeg(): Uint8Array {
  return concat(
    SOI,
    JFIF_WITH_THUMBNAIL,
    exif("II", camera("II"), MAKE_AND_GPS),
    XMP,
    ICC,
    MPF,
    PHOTOSHOP,
    COMMENT,
    DQT,
    frame(0xc0, 640, 480),
    DHT,
    SOS,
    DATA,
    EOI,
    TRAILER,
  );
}

function contains(haystack: Uint8Array, needle: readonly number[] | Uint8Array): boolean {
  const pattern = Array.from(needle);
  outer: for (let start = 0; start + pattern.length <= haystack.length; start += 1) {
    for (let index = 0; index < pattern.length; index += 1) {
      if (haystack[start + index] !== pattern[index]) continue outer;
    }
    return true;
  }
  return false;
}

function cleaned(input: Uint8Array) {
  const result = cleanJpeg(input);
  if (!result.ok) throw new Error(`expected a cleaned photo, got ${result.reason}`);
  return result;
}

describe("cleanJpeg", () => {
  it("keeps what draws the photo, byte for byte, and nothing that says where or on what it was taken", () => {
    const input = phoneJpeg();
    const before = input.slice();
    const result = cleaned(input);

    expect(result.width).toBe(640);
    expect(result.height).toBe(480);
    expect(result.bytes).toEqual(
      concat(SOI, JFIF_REBUILT, ICC, DQT, frame(0xc0, 640, 480), DHT, SOS, DATA, EOI),
    );
    for (const gone of [
      "Exif",
      "SecretPhone",
      "GPS",
      "http://ns.adobe.com",
      "Photoshop",
      "MPF",
      "shot on a",
    ]) {
      expect(contains(result.bytes, ascii(gone)), gone).toBe(false);
    }
    expect(contains(result.bytes, [0xde, 0xad, 0xbe, 0xef])).toBe(false);
    // The input is only read, and the photo kept is a buffer of exactly its own length.
    expect(input).toEqual(before);
    expect(result.bytes.buffer.byteLength).toBe(result.bytes.length);
  });

  it.each(["II", "MM"] as const)(
    "keeps an Orientation of 6 written %s, alone in an Exif of its own",
    (endian) => {
      const input = concat(
        SOI,
        exif(endian, camera(endian, [orientation(6, endian)]), MAKE_AND_GPS),
        DQT,
        frame(0xc0, 4032, 3024),
        DHT,
        SOS,
        DATA,
        EOI,
      );
      const result = cleaned(input);

      expect(result.bytes).toEqual(
        concat(SOI, orientationOnly(6), DQT, frame(0xc0, 4032, 3024), DHT, SOS, DATA, EOI),
      );
      expect(contains(result.bytes, ascii("SecretPhone"))).toBe(false);
      expect(contains(result.bytes, ascii("GPS"))).toBe(false);
      // Width and height are the frame's, as stored: turning it is the reader's job.
      expect([result.width, result.height]).toEqual([4032, 3024]);
    },
  );

  it.each([2, 3, 4, 5, 7, 8])("keeps every turn and flip Exif names, such as %i", (value) => {
    const input = concat(
      SOI,
      exif("MM", [orientation(value, "MM")]),
      frame(0xc0, 64, 48),
      SOS,
      DATA,
      EOI,
    );
    expect(cleaned(input).bytes).toEqual(
      concat(SOI, orientationOnly(value), frame(0xc0, 64, 48), SOS, DATA, EOI),
    );
  });

  it.each([
    ["an Orientation of 1", [orientation(1, "II")]],
    ["no Orientation", []],
    ["an Orientation of 9", [orientation(9, "II")]],
    [
      "an Orientation that is not a SHORT",
      [{ tag: 0x0112, type: 4, count: 1, value: u32(6, "II") }],
    ],
    ["two Orientation values", [{ tag: 0x0112, type: 3, count: 2, value: [6, 0, 6, 0] }]],
  ] as const)("writes no Exif at all for %s", (_, entries) => {
    const input = concat(SOI, exif("II", entries), frame(0xc0, 64, 48), SOS, DATA, EOI);
    expect(cleaned(input).bytes).toEqual(concat(SOI, frame(0xc0, 64, 48), SOS, DATA, EOI));
  });

  it("drops an Exif too broken to read without refusing the photo", () => {
    for (const broken of [
      segment(0xe1, [...ascii("Exif\0\0"), ...ascii("XX"), 0, 42, 0, 0, 0, 8]),
      segment(0xe1, [...ascii("Exif\0\0"), ...ascii("MM"), 0, 43, 0, 0, 0, 8, 0, 0]),
      segment(0xe1, [...ascii("Exif\0\0"), ...ascii("MM"), 0, 42, 0x7f, 0xff, 0xff, 0xff]),
      segment(0xe1, [...ascii("Exif\0\0"), ...ascii("II"), 42, 0, 8, 0, 0, 0, 0x40, 0]),
      segment(0xe1, ascii("Exif\0\0")),
    ]) {
      const input = concat(SOI, broken, frame(0xc0, 64, 48), SOS, DATA, EOI);
      expect(cleaned(input).bytes).toEqual(concat(SOI, frame(0xc0, 64, 48), SOS, DATA, EOI));
    }
  });

  it("takes the orientation from the first Exif only, and never the trailer's", () => {
    const input = concat(
      SOI,
      exif("II", [orientation(3, "II")]),
      exif("II", [orientation(6, "II")]),
      frame(0xc0, 64, 48),
      SOS,
      DATA,
      EOI,
      concat(SOI, exif("II", [orientation(8, "II")]), EOI),
    );
    expect(cleaned(input).bytes).toEqual(
      concat(SOI, orientationOnly(3), frame(0xc0, 64, 48), SOS, DATA, EOI),
    );
  });

  it("rebuilds JFIF from its version and density, with no thumbnail, and drops a JFXX extension", () => {
    const zeroDensity = segment(0xe0, [...ascii("JFIF\0"), 1, 1, 7, 0, 0, 0, 0, 0, 0]);
    const jfxx = segment(0xe0, [...ascii("JFXX\0"), 0x10, 0xff, 0xd8, 0xff, 0xd9]);
    const input = concat(SOI, zeroDensity, jfxx, frame(0xc0, 64, 48), SOS, DATA, EOI);

    expect(cleaned(input).bytes).toEqual(
      concat(
        SOI,
        segment(0xe0, [...ascii("JFIF\0"), 1, 1, 0, 0, 1, 0, 1, 0, 0]),
        frame(0xc0, 64, 48),
        SOS,
        DATA,
        EOI,
      ),
    );
    const short = segment(0xe0, [...ascii("JFIF\0"), 1, 1]);
    expect(cleaned(concat(SOI, short, frame(0xc0, 64, 48), SOS, DATA, EOI)).bytes).toEqual(
      concat(SOI, frame(0xc0, 64, 48), SOS, DATA, EOI),
    );
  });

  it("keeps the Adobe colour segment and restart intervals, and drops every other marker", () => {
    const input = concat(
      SOI,
      ADOBE,
      APP14_OTHER,
      APP3,
      APP15,
      segment(0xcc, [0x00, 0x10]), // DAC
      segment(0xc8, [0x00]), // JPG
      segment(0xf0, ascii("JPG0")),
      segment(0xfd, ascii("JPG13")),
      DQT,
      DRI,
      frame(0xc1, 64, 48),
      DHT,
      SOS,
      DATA,
      segment(0xdc, [0x00, 48]), // DNL, after the first scan
      segment(0xdf, [0x11]), // EXP
      segment(0xde, [0x00]), // DHP
      EOI,
    );
    expect(cleaned(input).bytes).toEqual(
      concat(SOI, ADOBE, DQT, DRI, frame(0xc1, 64, 48), DHT, SOS, DATA, EOI),
    );
  });

  it("keeps every scan of a progressive photo, and the tables between them", () => {
    const input = concat(
      SOI,
      DQT,
      frame(0xc2, 800, 600),
      DHT,
      SOS,
      DATA,
      DHT_AC,
      SOS_AC,
      DATA_2,
      COMMENT,
      SOS_AC,
      [0x01, 0xff, 0xd0, 0x02],
      EOI,
    );
    const result = cleaned(input);

    expect(result.bytes).toEqual(
      concat(
        SOI,
        DQT,
        frame(0xc2, 800, 600),
        DHT,
        SOS,
        DATA,
        DHT_AC,
        SOS_AC,
        DATA_2,
        SOS_AC,
        [0x01, 0xff, 0xd0, 0x02],
        EOI,
      ),
    );
    expect([result.width, result.height]).toEqual([800, 600]);
  });

  it("reads past fill bytes before a marker", () => {
    const input = concat(SOI, [0xff, 0xff], DQT, frame(0xc0, 64, 48), SOS, DATA, [0xff], EOI);
    expect(cleaned(input).bytes).toEqual(
      concat(SOI, DQT, frame(0xc0, 64, 48), SOS, DATA, [0xff], EOI),
    );
  });

  it("walks a megabyte of scan data to its end", () => {
    const data = new Uint8Array(1_048_576);
    for (let index = 0; index < data.length; index += 1) data[index] = (index * 131) & 0xff;
    // Every FF in the data is stuffed, as an encoder writes it.
    const stuffed: number[] = [];
    for (const byte of data.subarray(0, 4096))
      stuffed.push(...(byte === 0xff ? [0xff, 0] : [byte]));
    const body = concat(
      stuffed,
      data.map((byte) => (byte === 0xff ? 0xfe : byte)),
    );
    const input = concat(SOI, DQT, frame(0xc0, 1600, 1200), DHT, SOS, body, EOI);

    const result = cleaned(input);
    expect(result.bytes).toEqual(input);
  });

  describe("refuses", () => {
    it.each([
      ["PNG", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]],
      ["HEIC", [0, 0, 0, 0x18, ...ascii("ftypheic"), 0, 0, 0, 0, ...ascii("mif1heic")]],
      ["WebP", [...ascii("RIFF"), 0x24, 0, 0, 0, ...ascii("WEBPVP8 ")]],
      ["GIF", ascii("GIF89a")],
      ["a text file", ascii("hello")],
      ["one byte", [0x89]],
    ] as const)("%s as not a JPEG", (_, bytes) => {
      expect(cleanJpeg(Uint8Array.from(bytes))).toEqual({ ok: false, reason: "jpeg_only" });
    });

    it.each([
      [0xc3, "lossless"],
      [0xc5, "differential sequential"],
      [0xc6, "differential progressive"],
      [0xc7, "differential lossless"],
      [0xc9, "arithmetic extended"],
      [0xca, "arithmetic progressive"],
      [0xcb, "arithmetic lossless"],
      [0xcd, "arithmetic differential sequential"],
      [0xce, "arithmetic differential progressive"],
      [0xcf, "arithmetic differential lossless"],
    ] as const)("a JPEG with frame %s (%s) as not one it keeps", (marker, _kind) => {
      const input = concat(SOI, DQT, frame(marker, 64, 48), DHT, SOS, DATA, EOI);
      expect(cleanJpeg(input)).toEqual({ ok: false, reason: "jpeg_only" });
    });

    const whole = concat(SOI, DQT, frame(0xc0, 64, 48), DHT, SOS, DATA, EOI);

    it.each([
      ["nothing at all", new Uint8Array()],
      ["a lone FF", Uint8Array.of(0xff)],
      ["SOI alone", Uint8Array.from(SOI)],
      ["a file cut inside a segment", whole.subarray(0, 30)],
      ["a file cut inside its scan", concat(SOI, DQT, frame(0xc0, 64, 48), DHT, SOS, DATA)],
      ["a scan that ends on FF", concat(SOI, frame(0xc0, 64, 48), SOS, [0x12, 0xff])],
      ["a scan before its frame", concat(SOI, DQT, DHT, SOS, DATA, frame(0xc0, 64, 48), EOI)],
      [
        "a length past the end",
        concat(SOI, [0xff, 0xdb, 0x40, 0x00], DQT.subarray(4), frame(0xc0, 64, 48), EOI),
      ],
      ["a length under two", concat(SOI, [0xff, 0xdb, 0x00, 0x01], frame(0xc0, 64, 48), EOI)],
      ["an EOI with no scan", concat(SOI, DQT, frame(0xc0, 64, 48), EOI)],
      ["an EOI with no frame", concat(SOI, DQT, EOI)],
      ["two frames", concat(SOI, frame(0xc0, 64, 48), frame(0xc0, 64, 48), SOS, DATA, EOI)],
      ["a frame with no components", concat(SOI, segment(0xc0, [8, 0, 48, 0, 64, 0]), EOI)],
      ["a frame too short for its components", concat(SOI, segment(0xc0, [8, 0, 48, 0, 64, 3]))],
      ["a byte between segments", concat(SOI, [0x00], DQT, frame(0xc0, 64, 48), SOS, DATA, EOI)],
      ["a second SOI", concat(SOI, SOI, frame(0xc0, 64, 48), SOS, DATA, EOI)],
      ["a restart marker outside a scan", concat(SOI, [0xff, 0xd0], frame(0xc0, 64, 48), EOI)],
      ["FF00 outside a scan", concat(SOI, [0xff, 0x00], frame(0xc0, 64, 48), EOI)],
    ] as const)("%s as malformed", (_, input) => {
      expect(cleanJpeg(input)).toEqual({ ok: false, reason: "malformed" });
    });

    it.each([
      [0, 0],
      [640, 0],
      [0, 480],
      [MAX_PHOTO_SIDE + 1, 3000],
      [3000, MAX_PHOTO_SIDE + 1],
      [5000, 100],
      [4000, 100],
      [100, 2100],
    ])("a %i×%i photo as the wrong size", (width, height) => {
      const input = concat(SOI, DQT, frame(0xc0, width, height), DHT, SOS, DATA, EOI);
      expect(cleanJpeg(input)).toEqual({ ok: false, reason: "dimensions" });
    });

    it.each([
      [MAX_PHOTO_SIDE, MAX_PHOTO_SIDE],
      [2000, 2000 / MAX_PHOTO_ASPECT],
      [1, 1],
    ])("but keeps a %i×%i photo", (width, height) => {
      const input = concat(SOI, DQT, frame(0xc0, width, height), DHT, SOS, DATA, EOI);
      expect(cleaned(input)).toMatchObject({ width, height });
    });

    it("every cut of a whole photo, and never throws", () => {
      const input = phoneJpeg();
      const end = input.length - TRAILER.length;
      for (let cut = 0; cut < end; cut += 1) {
        const result = cleanJpeg(input.subarray(0, cut));
        expect(result.ok, `cut at ${cut}`).toBe(false);
      }
      expect(cleanJpeg(input.subarray(0, end)).ok).toBe(true);
    });

    it("never throws on a changed byte", () => {
      const input = phoneJpeg();
      for (let index = 0; index < input.length; index += 1) {
        for (const value of [0x00, 0xff, 0xd9, 0xda, 0xc3]) {
          const changed = input.slice();
          changed[index] = value;
          expect(() => cleanJpeg(changed)).not.toThrow();
        }
      }
    });
  });
});
