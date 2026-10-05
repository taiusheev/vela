import * as FileSystem from "expo-file-system/legacy";
import { requireOptionalNativeModule } from "expo-modules-core";
import { Platform } from "react-native";
import { ApiError, apiBaseUrl } from "../api/client.ts";
import { createAudioCache } from "./session-cache.ts";

interface Decoder {
  decode(sourceUri: string, destinationUri: string): Promise<string>;
}
const root = `${FileSystem.cacheDirectory ?? ""}vela-audio/`;
const temporary = () => `${root}${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const webFiles = new Set<string>();
const webDownloads = new Set<AbortController>();
const nativeDownloads = new Set<FileSystem.DownloadResumable>();
const DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

export const audioCache = createAudioCache({
  async download(path, token) {
    if (apiBaseUrl === undefined) throw new Error("Audio unavailable");
    if (Platform.OS === "web") {
      const controller = new AbortController();
      webDownloads.add(controller);
      const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
      try {
        const response = await fetch(`${apiBaseUrl}${path}`, {
          headers: { authorization: `Bearer ${token}` },
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new ApiError(response.status, "media", undefined);
        const reader = response.body?.getReader();
        if (reader === undefined) throw new Error("Audio unavailable");
        const chunks: ArrayBuffer[] = [];
        let bytes = 0;
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > MAX_SOURCE_BYTES) {
            controller.abort();
            throw new Error("Audio unavailable");
          }
          const chunk = new ArrayBuffer(part.value.byteLength);
          new Uint8Array(chunk).set(part.value);
          chunks.push(chunk);
        }
        const mime = (response.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
        const uri = URL.createObjectURL(new Blob(chunks, { type: mime }));
        webFiles.add(uri);
        return { uri, mime, bytes };
      } finally {
        clearTimeout(timeout);
        webDownloads.delete(controller);
      }
    }
    if (FileSystem.cacheDirectory === null) throw new Error("Audio unavailable");
    await FileSystem.makeDirectoryAsync(root, { intermediates: true });
    const uri = `${temporary()}.source`;
    const download = FileSystem.createDownloadResumable(
      `${apiBaseUrl}${path}`,
      uri,
      {
        headers: { authorization: `Bearer ${token}` },
      },
      (progress) => {
        if (
          progress.totalBytesWritten > MAX_SOURCE_BYTES ||
          progress.totalBytesExpectedToWrite > MAX_SOURCE_BYTES
        )
          void download.cancelAsync().catch(() => {});
      },
    );
    nativeDownloads.add(download);
    const timeout = setTimeout(() => {
      void download.cancelAsync().catch(() => {});
    }, DOWNLOAD_TIMEOUT_MS);
    try {
      const result = await download.downloadAsync();
      if (result === undefined) throw new Error("Audio unavailable");
      if (result.status !== 200) throw new ApiError(result.status, "media", undefined);
      const info = await FileSystem.getInfoAsync(uri);
      const mime =
        Object.entries(result.headers)
          .find(([key]) => key.toLowerCase() === "content-type")?.[1]
          .split(";")[0]
          ?.trim() ?? "";
      return { uri, mime, bytes: info.exists && !info.isDirectory ? info.size : 0 };
    } catch (error) {
      await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
      throw error;
    } finally {
      clearTimeout(timeout);
      nativeDownloads.delete(download);
    }
  },
  async decode(uri) {
    // Browsers already decode Ogg; the native Apple player receives bounded, locally decoded PCM.
    if (Platform.OS !== "ios") return uri;
    const decoder = requireOptionalNativeModule<Decoder>("VelaOpusDecoder");
    if (decoder === null) throw new Error("Audio decoder unavailable");
    return decoder.decode(uri, `${temporary()}.wav`);
  },
  async remove(uri) {
    if (uri.startsWith("blob:")) {
      URL.revokeObjectURL(uri);
      webFiles.delete(uri);
    } else await FileSystem.deleteAsync(uri, { idempotent: true });
  },
  async clear() {
    for (const controller of webDownloads) controller.abort();
    webDownloads.clear();
    await Promise.allSettled([...nativeDownloads].map((download) => download.cancelAsync()));
    nativeDownloads.clear();
    for (const uri of webFiles) URL.revokeObjectURL(uri);
    webFiles.clear();
    if (Platform.OS !== "web" && FileSystem.cacheDirectory !== null)
      await FileSystem.deleteAsync(root, { idempotent: true });
  },
});

const listeners = new Set<() => void>();
export async function clearAudioCache(): Promise<void> {
  const cleared = audioCache.clear();
  for (const stop of listeners) stop();
  await cleared;
}
export function registerAudioStop(stop: () => void): () => void {
  listeners.add(stop);
  return () => {
    listeners.delete(stop);
  };
}
export function stopOtherAudio(keep: () => void): void {
  for (const stop of listeners) if (stop !== keep) stop();
}
