import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => {
  const finished = Promise.withResolvers<
    { status: number; headers: Record<string, string> } | undefined
  >();
  return {
    finished,
    cancel: vi.fn(async () => {
      finished.resolve(undefined);
    }),
    download: vi.fn(() => finished.promise),
    create: vi.fn(),
    remove: vi.fn(async () => {}),
  };
});
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-modules-core", () => ({ requireOptionalNativeModule: () => null }));
vi.mock("../api/client.ts", () => ({
  apiBaseUrl: "https://vela.test",
  ApiError: class extends Error {
    readonly status: number;
    constructor(status: number) {
      super("Media refused");
      this.status = status;
    }
  },
}));
vi.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///Caches/",
  makeDirectoryAsync: async () => {},
  createDownloadResumable: io.create,
  getInfoAsync: async () => ({ exists: true, isDirectory: false, size: 200 }),
  deleteAsync: io.remove,
}));

import { audioCache, clearAudioCache } from "./cache.ts";

const FAMILY = "00000000-0000-4000-8000-000000000001";
const MEDIA = "00000000-0000-4000-8000-000000000002";
const account = { userId: "account", token: async () => "private-token" };

beforeEach(async () => {
  await clearAudioCache();
  vi.clearAllMocks();
  io.finished = Promise.withResolvers<
    { status: number; headers: Record<string, string> } | undefined
  >();
  io.download.mockImplementation(() => io.finished.promise);
  io.cancel.mockImplementation(async () => {
    io.finished.resolve(undefined);
  });
  io.create.mockReturnValue({ downloadAsync: io.download, cancelAsync: io.cancel });
});
afterEach(async () => {
  await clearAudioCache();
  vi.useRealTimers();
});

async function begun() {
  const promise = audioCache.prepare(account, FAMILY, MEDIA);
  await vi.waitFor(() => expect(io.download).toHaveBeenCalled());
  return { promise };
}

describe("native authenticated media downloads", () => {
  it("keeps authentication in request headers and deletes a refused download", async () => {
    const { promise } = await begun();
    expect(io.create.mock.calls[0]?.[0]).toBe(
      `https://vela.test/v1/families/${FAMILY}/media/${MEDIA}?role=original`,
    );
    expect(io.create.mock.calls[0]?.[2]).toEqual({
      headers: { authorization: "Bearer private-token" },
    });
    io.finished.resolve({ status: 404, headers: {} });
    await expect(promise).rejects.toMatchObject({ status: 404 });
    expect(io.remove).toHaveBeenCalledWith(expect.stringContaining(".source"), {
      idempotent: true,
    });
  });

  it("cancels the native request and removes its partial file at the thirty-second bound", async () => {
    vi.useFakeTimers();
    const promise = audioCache.prepare(account, FAMILY, MEDIA);
    const refused = expect(promise).rejects.toThrow("Audio unavailable");
    await vi.advanceTimersByTimeAsync(30_001);
    await refused;
    expect(io.cancel).toHaveBeenCalledOnce();
    expect(io.remove).toHaveBeenCalledWith(expect.stringContaining(".source"), {
      idempotent: true,
    });
  });

  it("cancels an active download during account cache clearing", async () => {
    const { promise } = await begun();
    const refused = expect(promise).rejects.toThrow("Audio unavailable");
    await clearAudioCache();
    await refused;
    expect(io.cancel).toHaveBeenCalledOnce();
    expect(io.remove).toHaveBeenCalledWith("file:///Caches/vela-audio/", { idempotent: true });
  });
});
