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

/** A voice is a few sentences; five minutes stops a recording left running in a pocket. */
export const LONGEST_MS = 5 * 60 * 1_000;

/**
 * A voice as both phones record it and Telegram takes it as a voice message: AAC in `.m4a`, one
 * channel at 64 kbit/s, about half a megabyte a minute, well under the 3 MiB the Worker keeps.
 */
const VOICE: RecordingOptions = {
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
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!keep) return null;
      if (uri !== null) {
        const done = { uri, key: recordingKey(), durationMs, levels: [...levels.current] };
        setRecorded(done);
        return done;
      }
      setFailed(true);
      return null;
    } catch (error) {
      // The recorder can be let go under a stop (the screen closing, a reload while developing):
      // the recording is lost, which she is told, and nothing is thrown at the screen.
      console.warn("[recording] stop failed", (error as Error)?.name);
      if (keep) setFailed(true);
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
      try {
        const permission = await requestRecordingPermissionsAsync();
        if (!permission.granted) {
          setRefused(true);
          return;
        }
        setRefused(false);
        setFailed(false);
        setRecorded(null);
        levels.current = [];
        player.pause();
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await recorder.prepareToRecordAsync();
        recorder.record();
      } catch {
        setRecorded(null);
        setFailed(true);
      }
    },
    stop: () => stop(true),
    async cancel() {
      await stop(false);
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
      player.pause();
      setRecorded(null);
    },
  };
}

/** A length as it is read on a clock: 0:42, 2:05. */
export function clock(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1_000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
