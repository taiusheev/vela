import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";

let clearing: Promise<void> = Promise.resolve();

export async function waitForRecordingCleanup(): Promise<void> {
  await clearing;
}

const stops = new Set<() => Promise<void>>();

export async function removeRecordingFile(uri: string | null): Promise<void> {
  if (uri === null) return;
  if (uri.startsWith("blob:")) URL.revokeObjectURL(uri);
  else if (Platform.OS !== "web") await FileSystem.deleteAsync(uri, { idempotent: true });
}

export function registerRecordingStop(stop: () => Promise<void>): () => void {
  stops.add(stop);
  return () => {
    stops.delete(stop);
  };
}

/** Expo Audio 57 writes native recordings here. Sweep only its recording files, including
 * leftovers from a crash/older app; playback and other cache files have separate owners. */
export function clearRecordingFiles(): Promise<void> {
  clearing = clearing.catch(() => {}).then(sweepRecordingFiles);
  return clearing;
}

async function sweepRecordingFiles(): Promise<void> {
  await Promise.all([...stops].map((stop) => stop()));
  if (Platform.OS === "web" || FileSystem.cacheDirectory === null) return;
  for (const folder of ["ExpoAudio", "Audio"]) {
    const root = `${FileSystem.cacheDirectory}${folder}/`;
    const info = await FileSystem.getInfoAsync(root);
    if (!info.exists || !info.isDirectory) continue;
    const files = await FileSystem.readDirectoryAsync(root);
    await Promise.all(
      files
        .filter((name) => /^recording-[\w-]+\.(m4a|webm|aac|wav|3gp|mp4)$/.test(name))
        .map((name) => removeRecordingFile(`${root}${name}`)),
    );
  }
}
