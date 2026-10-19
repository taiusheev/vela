import { Directory, File, Paths } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { launchImageLibraryAsync } from "expo-image-picker";
import { Platform } from "react-native";
import { portraits } from "../storage/portraits.ts";
import { registerOnboardingPhotoCleanup } from "./onboarding-draft.ts";

/**
 * Onboarding asks for her photo before there is a family to keep it under, and before the organiser
 * has signed in. So the photo is prepared as `usePortrait` prepares one (cropped 3:4, 480 wide,
 * JPEG) and waits as a file in the app's cache, or a data URL on the web, until saving installs it
 * in the signed-in session's private portraits. It never leaves the phone.
 */
function inCache(uri: string): boolean {
  return uri.startsWith(`${new Directory(Paths.cache).uri.replace(/\/+$/, "")}/`);
}

function discard(uri: string): void {
  if (Platform.OS === "web" || !inCache(uri)) return;
  try {
    const temporary = new File(uri);
    if (temporary.exists) temporary.delete();
  } catch {
    /* A leftover cache file is cleared with the cache; it must not fail the step. */
  }
}

const pendingDirectory = () => new Directory(Paths.cache, "vela-onboarding-portraits");
/** Interrupted previews never survive a process restart. This directory holds no installed portraits. */
export function clearPendingOnboardingPortraits(): void {
  if (Platform.OS === "web") return;
  try {
    const directory = pendingDirectory();
    if (directory.exists) directory.delete();
  } catch {
    /* Cache cleanup can be retried. */
  }
}
clearPendingOnboardingPortraits();
registerOnboardingPhotoCleanup(discard);

/** The photo the organiser picked, ready to install; null when they closed the picker. */
export async function pickOnboardingPortrait(): Promise<string | null> {
  const picked = await launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing: true,
    aspect: [3, 4],
    quality: 1,
    exif: false,
  });
  const asset = picked.canceled ? undefined : picked.assets[0];
  if (!asset) return null;
  const drawing = ImageManipulator.manipulate(asset.uri);
  const image = await drawing.resize({ width: 480 }).renderAsync();
  try {
    const saved = await image.saveAsync({
      format: SaveFormat.JPEG,
      compress: 0.8,
      base64: Platform.OS === "web",
    });
    if (Platform.OS === "web") return `data:image/jpeg;base64,${saved.base64}`;
    const directory = pendingDirectory();
    directory.create({ intermediates: true, idempotent: true });
    const managed = new File(
      directory,
      `preview-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`,
    );
    try {
      new File(saved.uri).copy(managed);
    } catch (error) {
      if (managed.exists) managed.delete();
      throw error;
    } finally {
      discard(saved.uri);
    }
    return managed.uri;
  } finally {
    discard(asset.uri);
    image.release();
    drawing.release();
  }
}

/** Installs a prepared photo as her portrait in this session, and drops the waiting copy. */
export function installOnboardingPortrait(
  scope: string,
  familyId: string,
  memberId: string,
  source: string,
): string {
  const uri = portraits.save(scope, familyId, memberId, source);
  discard(source);
  return uri;
}

/** Forgets a prepared photo the organiser replaced or never saved. */
export function discardOnboardingPortrait(source: string): void {
  discard(source);
}
