import {
  AudioQuality,
  IOSOutputFormat,
  type RecordingOptions,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
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
}

export interface Recording {
  recording: boolean;
  /** How long it has run, while it runs. */
  elapsedMs: number;
  /** The level now, from 0 to 1, for a meter that moves with the voice. */
  level: number;
  recorded: Recorded | null;
  /** The microphone was refused. */
  refused: boolean;
  /** The last recording could not be kept; recording again is the way on. */
  failed: boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
  listen(): Promise<void>;
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
  const stopping = useRef(false);

  const stop = async () => {
    if (stopping.current) return;
    stopping.current = true;
    const durationMs = state.durationMillis;
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (uri !== null) {
        setRecorded({ uri, key: recordingKey(), durationMs });
      } else {
        setFailed(true);
      }
    } catch (error) {
      // The recorder can be let go under a stop (the screen closing, a reload while developing):
      // the recording is lost, which she is told, and nothing is thrown at the screen.
      console.warn("[recording] stop failed", (error as Error)?.name);
      setFailed(true);
    } finally {
      stopping.current = false;
    }
  };

  useEffect(() => {
    if (state.isRecording && state.durationMillis >= longest) void stop();
  });

  return {
    recording: state.isRecording,
    elapsedMs: state.durationMillis,
    // Metering is in decibels, -160 for silence up to 0; speech sits around -40 to -10.
    level: Math.min(Math.max(((state.metering ?? -160) + 60) / 60, 0.04), 1),
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
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await recorder.prepareToRecordAsync();
        recorder.record();
      } catch {
        setRecorded(null);
        setFailed(true);
      }
    },
    stop,
    async listen() {
      try {
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
        await player.seekTo(0);
        player.play();
      } catch {
        setFailed(true);
      }
    },
    clear() {
      setRecorded(null);
    },
  };
}

/** A length as it is read on a clock: 0:42, 2:05. */
export function clock(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1_000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
