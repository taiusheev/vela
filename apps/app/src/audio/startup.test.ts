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
    expect(download).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
