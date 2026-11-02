import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { launchImageLibraryAsync } from "expo-image-picker";
import { fitWithin, JPEG_QUALITY } from "./photos.ts";

/** A photo chosen for an ask and re-encoded on the phone, ready to upload as it is. */
export interface PickedPhoto {
  uri: string;
  width: number;
  height: number;
}

/**
 * Re-encode a photo as a JPEG whose long side is at most 1600 px (ADR-33). HEIC, PNG and WebP
 * become JPEG, and most of what the camera wrote beside the picture is left behind; the Worker
 * strips whatever remains, so nothing here is relied on for that. The photo is drawn once, and
 * resized from that drawing only when it is larger, so its own upright size decides which side is
 * the long one.
 */
export async function reencodePhoto(uri: string): Promise<PickedPhoto> {
  const drawing = ImageManipulator.manipulate(uri);
  const drawn = await drawing.renderAsync();
  const size = fitWithin(drawn.width, drawn.height);
  const resizing = size === null ? null : ImageManipulator.manipulate(drawn).resize(size);
  const image = resizing === null ? drawn : await resizing.renderAsync();
  try {
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY });
    return { uri: saved.uri, width: saved.width, height: saved.height };
  } finally {
    // Native memory held by the drawings, let go as soon as the file is written.
    drawing.release();
    drawn.release();
    if (resizing !== null) resizing.release();
    if (image !== drawn) image.release();
  }
}

/**
 * One photo from the phone's library, or null when nothing was chosen. The system picker needs no
 * permission to read the library, and the camera is never offered.
 */
export async function pickPhoto(): Promise<PickedPhoto | null> {
  const picked = await launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: false,
    quality: 1,
    exif: false,
  });
  const asset = picked.canceled ? undefined : picked.assets[0];
  return asset === undefined ? null : reencodePhoto(asset.uri);
}

/**
 * Several photos from the phone's library at once, for the photo box (ADR-58), each re-encoded as
 * `pickPhoto` does; an empty list when nothing was chosen. At most `limit` can be chosen. A photo
 * the phone cannot re-encode is left out, and counted, so the screen can say so.
 */
export async function pickPhotos(
  limit: number,
): Promise<{ photos: PickedPhoto[]; unusable: number }> {
  const picked = await launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: true,
    selectionLimit: limit,
    orderedSelection: true,
    quality: 1,
    exif: false,
  });
  if (picked.canceled) return { photos: [], unusable: 0 };
  const photos: PickedPhoto[] = [];
  let unusable = 0;
  for (const asset of picked.assets.slice(0, limit)) {
    try {
      photos.push(await reencodePhoto(asset.uri));
    } catch {
      unusable += 1;
    }
  }
  return { photos, unusable };
}
