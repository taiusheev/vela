import { describe, expect, it, vi } from "vitest";
import { type AudioCachePorts, type AudioDownload, createAudioCache } from "./session-cache.ts";

const FAMILY = "00000000-0000-4000-8000-000000000001";
const MEDIA = "00000000-0000-4000-8000-000000000002";
const session = { userId: "account-a", token: vi.fn(async () => "short-lived-token") };
function ports(overrides: Partial<AudioCachePorts> = {}): AudioCachePorts {
  return {
    download: vi.fn(async () => ({ uri: "file:///source.ogg", mime: "audio/ogg", bytes: 500 })),
    decode: vi.fn(async () => "file:///decoded.wav"),
    remove: vi.fn(async () => {}),
    clear: vi.fn(async () => {}),
    ...overrides,
  };
}
describe("authenticated temporary audio", () => {
  it("requests the original through the family API, decodes Ogg locally and discards its source", async () => {
    const io = ports();
    const cache = createAudioCache(io);
    expect(await cache.prepare(session, FAMILY, MEDIA)).toBe("file:///decoded.wav");
    expect(io.download).toHaveBeenCalledWith(
      `/v1/families/${FAMILY}/media/${MEDIA}?role=original`,
      "short-lived-token",
    );
    expect(io.decode).toHaveBeenCalledWith("file:///source.ogg");
    expect(io.remove).toHaveBeenCalledWith("file:///source.ogg");
    await cache.release("file:///decoded.wav");
    expect(io.remove).toHaveBeenCalledWith("file:///decoded.wav");
  });
  it("reauthorizes every replay and plays M4A without decoding", async () => {
    const io = ports({
      download: vi.fn(async () => ({ uri: "file:///source.m4a", mime: "audio/mp4", bytes: 500 })),
    });
    const cache = createAudioCache(io);
    await cache.prepare(session, FAMILY, MEDIA);
    await cache.prepare(session, FAMILY, MEDIA);
    expect(io.download).toHaveBeenCalledTimes(2);
    expect(io.decode).not.toHaveBeenCalled();
  });
  it("refreshes the bearer once after a 401, without retrying a refused membership", async () => {
    const io = ports({
      download: vi
        .fn()
        .mockRejectedValueOnce(Object.assign(new Error(), { status: 401 }))
        .mockResolvedValueOnce({ uri: "file:///source.m4a", mime: "audio/mp4", bytes: 500 }),
    });
    const who = {
      userId: "a",
      token: vi.fn().mockResolvedValueOnce("old").mockResolvedValueOnce("fresh"),
    };
    await createAudioCache(io).prepare(who, FAMILY, MEDIA);
    expect(who.token).toHaveBeenLastCalledWith({ fresh: true });
    const denied = ports({
      download: vi.fn(async () => {
        throw Object.assign(new Error(), { status: 404 });
      }),
    });
    await expect(createAudioCache(denied).prepare(session, FAMILY, MEDIA)).rejects.toThrow();
    expect(denied.download).toHaveBeenCalledTimes(1);
  });
  it("invalidates a download synchronously at sign-out and deletes the late file", async () => {
    let finish!: (value: { uri: string; mime: string; bytes: number }) => void;
    const started = Promise.withResolvers<void>();
    const io = ports({
      download: vi.fn(() => {
        started.resolve();
        return new Promise<AudioDownload>((resolve) => {
          finish = resolve;
        });
      }),
    });
    const cache = createAudioCache(io);
    const preparing = cache.prepare(session, FAMILY, MEDIA);
    await started.promise;
    const clearing = cache.clear();
    finish({ uri: "file:///late.ogg", mime: "audio/ogg", bytes: 500 });
    await expect(preparing).rejects.toThrow();
    await clearing;
    expect(io.remove).toHaveBeenCalledWith("file:///late.ogg");
    expect(io.decode).not.toHaveBeenCalled();
  });
  it("does not let an old account resume while another account's cleanup is pending", async () => {
    const cleared = Promise.withResolvers<void>();
    const io = ports({ clear: vi.fn(() => cleared.promise) });
    const cache = createAudioCache(io);
    const old = cache.prepare(session, FAMILY, MEDIA);
    const current = cache.prepare({ userId: "account-b", token: async () => "b" }, FAMILY, MEDIA);
    cleared.resolve();
    await expect(old).rejects.toThrow("Session ended");
    await expect(current).resolves.toBe("file:///decoded.wav");
    expect(io.download).toHaveBeenCalledTimes(1);
  });
  it("refuses expired media, injected paths, oversized or non-audio bytes", async () => {
    const io = ports();
    const cache = createAudioCache(io);
    await expect(cache.prepare(session, FAMILY, MEDIA, "2020-01-01T00:00:00Z")).rejects.toThrow();
    await expect(cache.prepare(session, "../../other-family", MEDIA)).rejects.toThrow();
    expect(io.download).not.toHaveBeenCalled();
    for (const source of [
      { uri: "file:///bad", mime: "text/html", bytes: 40 },
      { uri: "file:///big", mime: "audio/ogg", bytes: 20 * 1024 * 1024 + 1 },
    ]) {
      const fake = ports({ download: async () => source });
      await expect(createAudioCache(fake).prepare(session, FAMILY, MEDIA)).rejects.toThrow();
      expect(fake.remove).toHaveBeenCalledWith(source.uri);
      expect(fake.decode).not.toHaveBeenCalled();
    }
  });
  it("bounds local playback files and deletes a decoded voice that finishes after sign-out", async () => {
    let sequence = 0;
    const decoded = Promise.withResolvers<string>();
    const decoding = Promise.withResolvers<void>();
    const io = ports({
      download: async () => ({
        uri: `file:///source-${++sequence}.m4a`,
        mime: "audio/mp4",
        bytes: 100,
      }),
      decode: () => {
        decoding.resolve();
        return decoded.promise;
      },
    });
    const cache = createAudioCache(io);
    for (let n = 0; n < 4; n++) await cache.prepare(session, FAMILY, MEDIA);
    expect(io.remove).toHaveBeenCalledWith("file:///source-1.m4a");
    io.download = async () => ({ uri: "file:///late.ogg", mime: "audio/ogg", bytes: 100 });
    const late = cache.prepare(session, FAMILY, MEDIA);
    await decoding.promise;
    await cache.clear();
    decoded.resolve("file:///late.wav");
    await expect(late).rejects.toThrow("Session ended");
    expect(io.remove).toHaveBeenCalledWith("file:///late.ogg");
    expect(io.remove).toHaveBeenCalledWith("file:///late.wav");
  });
});
