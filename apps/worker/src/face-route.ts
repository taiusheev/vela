/**
 * The faces LINE shows beside a family member's messages (`OutboundMessage.from`, LINE's `sender`):
 * their initial in white on a disc of their colour, drawn here from the outlines in
 * `@vela/adapters` and served as a PNG at
 *
 *   <PILOT_PUBLIC_URL>/faces/v1/<code point in hex>-<colour>.png
 *
 * A face holds one character and a colour, nothing else about the family, so the URL is not signed:
 * anyone may draw any of the 5,437 initials in any of the four colours, as LINE and every phone in
 * a chat must. A picture never changes for its URL, so it is cached for a year.
 */
import {
  type Face,
  type FaceGlyphs,
  facePath,
  parseFacePath,
  readFaceGlyphs,
  renderFace,
} from "@vela/adapters";
import glyphBytes from "@vela/adapters/face-glyphs.bin";

/** Where the face route answers; each URL goes on with `<code point>-<colour>.png`. */
export const FACE_PATH_PREFIX = "/faces/v1/";

let glyphs: FaceGlyphs | undefined;

/** Read once per isolate, when the first face is asked for. */
function faceGlyphs(): FaceGlyphs {
  glyphs ??= readFaceGlyphs(new Uint8Array(glyphBytes));
  return glyphs;
}

/** The URL of a face this Worker can draw, or undefined for an initial it holds no outline for. */
export function createFaceUrl(pilotOrigin: string): (face: Face) => string | undefined {
  return (face) =>
    faceGlyphs().outline(face.codePoint) === null ? undefined : `${pilotOrigin}${facePath(face)}`;
}

/** The PNG a face file name names, or null for a name this route does not serve. */
export async function openFace(file: string): Promise<Response | null> {
  const face = parseFacePath(file);
  if (face === null) return null;
  const png = await renderFace(faceGlyphs(), face.codePoint, face.colour);
  if (png === null) return null;
  return new Response(png, {
    headers: {
      "content-type": "image/png",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
