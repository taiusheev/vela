import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearRecordingFiles } from "./recording-files.ts";
import { type Recording, useRecording } from "./useRecording.ts";

const disk = vi.hoisted(() => ({ files: new Set<string>(), removed: vi.fn(), serial: 0 }));
const audio = vi.hoisted(() => ({
  state: { isRecording: false, durationMillis: 1000, metering: -30 },
  permission: vi.fn(),
  prepare: vi.fn(),
  stop: vi.fn(),
  uri: "file:///cache/ExpoAudio/recording-initial.m4a",
  player: { pause: vi.fn(), play: vi.fn(), seekTo: vi.fn() },
}));
vi.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  deleteAsync: async (uri: string) => {
    disk.removed(uri);
    disk.files.delete(uri);
  },
  getInfoAsync: async (uri: string) => ({ exists: uri.endsWith("/"), isDirectory: true }),
  readDirectoryAsync: async (root: string) =>
    [...disk.files].filter((uri) => uri.startsWith(root)).map((uri) => uri.slice(root.length)),
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("../api/upload.ts", () => ({ recordingKey: () => "synthetic-recording-key" }));
vi.mock("expo-audio", () => ({
  AudioQuality: { HIGH: 1 },
  IOSOutputFormat: { MPEG4AAC: "aac" },
  requestRecordingPermissionsAsync: () => audio.permission(),
  setAudioModeAsync: vi.fn(),
  useAudioRecorder: () => recorder,
  useAudioRecorderState: () => audio.state,
  useAudioPlayer: () => audio.player,
  useAudioPlayerStatus: () => ({ playing: false, duration: 1, currentTime: 0 }),
}));
const recorder = {
  get uri() {
    return audio.uri;
  },
  prepareToRecordAsync: () => audio.prepare(),
  record: () => {
    audio.state.isRecording = true;
  },
  stop: () => audio.stop(),
};
let current: Recording;
let renderer: ReactTestRenderer | undefined;
function Probe() {
  current = useRecording();
  return null;
}
async function mount() {
  await act(async () => {
    renderer = create(createElement(Probe));
  });
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  disk.files.clear();
  disk.removed.mockClear();
  disk.serial = 0;
  audio.state.isRecording = false;
  audio.uri = "file:///cache/ExpoAudio/recording-initial.m4a";
  disk.files.add(audio.uri);
  audio.permission.mockReset().mockResolvedValue({ granted: true });
  audio.prepare.mockReset().mockImplementation(async () => {
    audio.uri = `file:///cache/ExpoAudio/recording-${++disk.serial}.m4a`;
    disk.files.add(audio.uri);
  });
  audio.stop.mockReset().mockImplementation(async () => {
    audio.state.isRecording = false;
  });
});
afterEach(async () => {
  await act(async () => {
    renderer?.unmount();
  });
  renderer = undefined;
});

describe("recorded files", () => {
  it("keeps a stopped voice for retry, then deletes it after send or discard", async () => {
    await mount();
    await act(async () => {
      await current.start();
      await current.stop();
    });
    const uri = current.recorded?.uri;
    expect(uri).toBeDefined();
    expect(disk.files.has(uri ?? "")).toBe(true);
    await act(async () => {
      current.clear();
    });
    expect(current.recorded).toBeNull();
    expect(disk.files.size).toBe(0);
  });
  it("deletes a cancelled recording", async () => {
    await mount();
    await act(async () => {
      await current.start();
      await current.cancel();
    });
    expect(current.recorded).toBeNull();
    expect(disk.files.size).toBe(0);
  });
  it("deletes the previous take when recording again", async () => {
    await mount();
    await act(async () => {
      await current.start();
      await current.stop();
    });
    const previous = current.recorded?.uri;
    await act(async () => {
      await current.start();
    });
    expect(disk.files.has(previous ?? "")).toBe(false);
    expect(disk.files.size).toBe(1);
  });
  it("stops and deletes a recording when its screen closes", async () => {
    await mount();
    await act(async () => {
      await current.start();
    });
    await act(async () => {
      renderer?.unmount();
    });
    renderer = undefined;
    expect(audio.state.isRecording).toBe(false);
    expect(disk.files.size).toBe(0);
  });
  it("cannot keep a late stop result after the account session ends", async () => {
    await mount();
    await act(async () => {
      await current.start();
    });
    let finish: (() => void) | undefined;
    audio.stop.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () => {
      const stopping = current.stop();
      await clearRecordingFiles();
      finish?.();
      expect(await stopping).toBeNull();
    });
    expect(current.recorded).toBeNull();
    expect(disk.files.size).toBe(0);
  });
  it("does not start recording if permission resolves after the screen closes", async () => {
    await mount();
    let permit: ((value: { granted: boolean }) => void) | undefined;
    audio.permission.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          permit = resolve;
        }),
    );
    const starting = current.start();
    await act(async () => {
      renderer?.unmount();
    });
    renderer = undefined;
    permit?.({ granted: true });
    await starting;
    expect(audio.prepare).not.toHaveBeenCalled();
    expect(disk.files.size).toBe(0);
  });
  it("sweeps old native recording files while preserving unrelated cache files", async () => {
    disk.files.add("file:///cache/Audio/recording-interrupted.m4a");
    disk.files.add("file:///cache/ExpoAudio/other-cache.txt");
    await clearRecordingFiles();
    expect([...disk.files]).toEqual(["file:///cache/ExpoAudio/other-cache.txt"]);
  });
});
