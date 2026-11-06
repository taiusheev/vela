import { expect, it, vi } from "vitest";

const { remove, download, fetchMock } = vi.hoisted(() => ({
  remove: vi.fn(async () => {}),
  download: vi.fn(),
  fetchMock: vi.fn(),
}));
vi.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///private-cache/",
  deleteAsync: remove,
  createDownloadResumable: download,
  getInfoAsync: async () => ({ exists: true, isDirectory: true }),
  readDirectoryAsync: async () => ["recording-interrupted.m4a", "unrelated.txt"],
}));
vi.mock("expo-modules-core", () => ({ requireOptionalNativeModule: vi.fn() }));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

it("removes audio left by an interrupted run at startup without any playback or network", async () => {
  vi.stubGlobal("fetch", fetchMock);
  try {
    await import("./cache.ts");
    await vi.waitFor(() =>
      expect(remove).toHaveBeenCalledWith("file:///private-cache/vela-audio/", {
        idempotent: true,
      }),
    );
    await vi.waitFor(() =>
      expect(remove).toHaveBeenCalledWith(
        "file:///private-cache/ExpoAudio/recording-interrupted.m4a",
        { idempotent: true },
      ),
    );
    expect(remove).not.toHaveBeenCalledWith(
      "file:///private-cache/ExpoAudio/unrelated.txt",
      expect.anything(),
    );
    expect(download).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
