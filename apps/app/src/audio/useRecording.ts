import {
  AudioQuality,
  IOSOutputFormat,
  type RecordingOptions,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { useEffect, useRef, useState } from "react";
import { recordingKey } from "../api/upload.ts";
import {
  registerRecordingStop,
  removeRecordingFile,
  waitForRecordingCleanup,
} from "./recording-files.ts";

async function remove(uri: string | null): Promise<void> {
  await removeRecordingFile(uri).catch(() => {});
}

/** A voice is a few sentences; five minutes stops a recording left running in a pocket. */
export const LONGEST_MS = 5 * 60 * 1_000;

/**
 * A voice as both phones record it and Telegram takes it as a voice message: AAC in `.m4a`, one
 * channel at 64 kbit/s, about half a megabyte a minute, well under the 3 MiB the Worker keeps.
 */
const VOICE: RecordingOptions = {
  directory: "cache",
  extension: ".m4a",
  sampleRate: 44_100,
  numberOfChannels: 1,
  bitRate: 64_000,
  isMeteringEnabled: true,
  android: { outputFormat: "mpeg4", audioEncoder: "aac" },
  ios: {
    outputFormat: IOSOutputFormat.MPEG4AAC,
    audioQuality: AudioQuality.HIGH,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: { mimeType: "audio/webm", bitsPerSecond: 64_000 },
};

/** A finished recording: the file the phone wrote, the key minted for it, and its length. */
export interface Recorded {
  uri: string;
  key: string;
  durationMs: number;
  /** Its level at each reading while it recorded, 0 to 1: the voice's own bars. */
  levels?: number[];
}

/** Metering is in decibels, -160 for silence up to 0; speech sits around -40 to -10. */
export function levelOf(metering: number | undefined): number {
  return Math.min(Math.max(((metering ?? -160) + 60) / 60, 0.04), 1);
}

export interface Recording {
  recording: boolean;
  /** How long it has run, while it runs. */
  elapsedMs: number;
  /** The level now, from 0 to 1, for a meter that moves with the voice. */
  level: number;
  /** Every level read so far in this recording, oldest first. */
  levels: readonly number[];
  /** The finished recording is playing back, and how far it has played. */
  playing: boolean;
  playedMs: number;
  recorded: Recorded | null;
  /** The microphone was refused. */
  refused: boolean;
  /** The last recording could not be kept; recording again is the way on. */
  failed: boolean;
  start(): Promise<void>;
  /** Stops and keeps the recording; resolves with it, or null when it could not be kept. */
  stop(): Promise<Recorded | null>;
  /** Stops and throws the recording away. */
  cancel(): Promise<void>;
  /** Plays the finished recording, or pauses it while it plays. */
  listen(): Promise<void>;
  seek(fraction: number): void;
  /** Lets the finished recording go, after it was sent. */
  clear(): void;
}

/**
 * One voice recorded on the phone, for her answer (P4) or a reply from the family (A8): the
 * microphone asked for on the first tap, never before; a level and the time while it records; a
 * stop of its own at five minutes, or at `maxMs` (a voice hello stops at ten seconds); and the finished file with a key minted once, so sending it
 * again after trouble is the same recording, never two.
 */
export function useRecording(options: { maxMs?: number } = {}): Recording {
  const longest = options.maxMs ?? LONGEST_MS;
  const recorder = useAudioRecorder(VOICE);
  const state = useAudioRecorderState(recorder, 200);
  const [recorded, setRecorded] = useState<Recorded | null>(null);
  const [refused, setRefused] = useState(false);
  const [failed, setFailed] = useState(false);
  const player = useAudioPlayer(recorded?.uri ?? null);
  const played = useAudioPlayerStatus(player);
  const stopping = useRef(false);
  const starting = useRef(false);
  const alive = useRef(true);
  const generation = useRef(0);
  const file = useRef<string | null>(recorder.uri);
  const playback = useRef(player);
  playback.current = player;
  useEffect(() => {
    alive.current = true;
    const discard = async () => {
      generation.current++;
      try {
        playback.current.pause();
      } catch {
        /* Player may already be released. */
      }
      const uri = file.current;
      file.current = null;
      if (alive.current) setRecorded(null);
      try {
        await recorder.stop();
      } catch {
        /* Already stopped or released. */
      }
      await remove(uri);
    };
    const unregister = registerRecordingStop(discard);
    return () => {
      alive.current = false;
      unregister();
      void discard();
    };
  }, [recorder]);
  const levels = useRef<number[]>([]);
  const level = levelOf(state.metering);

  // One reading a tick while it records (the state above is read every 200 ms).
  // biome-ignore lint/correctness/useExhaustiveDependencies: A reading is taken as the time moves.
  useEffect(() => {
    if (state.isRecording) levels.current.push(level);
  }, [state.isRecording, state.durationMillis]);

  const stop = async (keep = true): Promise<Recorded | null> => {
    if (stopping.current) return null;
    stopping.current = true;
    const durationMs = state.durationMillis;
    const begun = generation.current;
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!keep || !alive.current || generation.current !== begun) {
        await remove(uri);
        if (file.current === uri) file.current = null;
        return null;
      }
      if (uri !== null) {
        const done = { uri, key: recordingKey(), durationMs, levels: [...levels.current] };
        file.current = uri;
        setRecorded(done);
        return done;
      }
      setFailed(true);
      return null;
    } catch (error) {
      // The recorder can be let go under a stop (the screen closing, a reload while developing):
      // the recording is lost, which she is told, and nothing is thrown at the screen.
      console.warn("[recording] stop failed", (error as Error)?.name);
      if (keep && alive.current && generation.current === begun) setFailed(true);
      await remove(file.current);
      file.current = null;
      return null;
    } finally {
      stopping.current = false;
    }
  };

  useEffect(() => {
    if (state.isRecording && state.durationMillis >= longest) void stop();
  });

  const durationS = played.duration > 0 ? played.duration : (recorded?.durationMs ?? 0) / 1_000;
  return {
    recording: state.isRecording,
    elapsedMs: state.durationMillis,
    level,
    levels: levels.current,
    playing: played.playing,
    playedMs:
      durationS > 0 && played.currentTime >= durationS - 0.05
        ? 0
        : Math.round(played.currentTime * 1_000),
    recorded,
    refused,
    failed,
    async start() {
      if (starting.current || stopping.current || state.isRecording) return;
      starting.current = true;
      const begun = ++generation.current;
      try {
        const permission = await requestRecordingPermissionsAsync();
        if (!alive.current || generation.current !== begun) return;
        if (!permission.granted) {
          setRefused(true);
          return;
        }
        await waitForRecordingCleanup();
        if (!alive.current || generation.current !== begun) return;
        setRefused(false);
        setFailed(false);
        await remove(file.current);
        file.current = null;
        setRecorded(null);
        levels.current = [];
        player.pause();
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        if (!alive.current || generation.current !== begun) return;
        await recorder.prepareToRecordAsync();
        file.current = recorder.uri;
        if (!alive.current || generation.current !== begun) {
          try {
            await recorder.stop();
          } catch {
            /* Prepared but never started. */
          }
          await remove(file.current);
          file.current = null;
          return;
        }
        recorder.record();
      } catch {
        await remove(file.current);
        file.current = null;
        if (alive.current && generation.current === begun) {
          setRecorded(null);
          setFailed(true);
        }
      } finally {
        starting.current = false;
      }
    },
    stop: () => stop(true),
    async cancel() {
      generation.current++;
      await stop(false);
      await remove(file.current);
      file.current = null;
      levels.current = [];
      setRecorded(null);
    },
    async listen() {
      if (played.playing) {
        player.pause();
        return;
      }
      try {
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
        if (durationS > 0 && played.currentTime >= durationS - 0.05) await player.seekTo(0);
        player.play();
      } catch {
        setFailed(true);
      }
    },
    seek(fraction) {
      if (durationS > 0) void player.seekTo(fraction * durationS);
    },
    clear() {
      generation.current++;
      player.pause();
      void remove(file.current);
      file.current = null;
      setRecorded(null);
    },
  };
}

/** A length as it is read on a clock: 0:42, 2:05. */
export function clock(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1_000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
