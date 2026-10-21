import { useLingui } from "@lingui/react/macro";
import type { Recorded } from "../audio/useRecording.ts";
import { VoiceRecorder } from "./voice-recorder.tsx";

/** A voice hello is about ten seconds (spec §4); the recorder stops itself there. */
const HELLO_MS = 10_000;

/**
 * The voice hello on Ask (spec §4, A7): about ten seconds of the asker's own voice, which plays to
 * her before the ask. Recorded here and handed to the caller as soon as it stops, which starts
 * sending it up then, so the ask goes the moment Send is pressed.
 */
export function VoiceHello({
  onChange,
  note = false,
}: {
  onChange(recorded: Recorded | null): void;
  /** A voice note ask: the recording is the ask itself, not a hello before it (spec §4). */
  note?: boolean;
}) {
  const { t } = useLingui();
  return (
    <VoiceRecorder
      label={note ? t`Record your voice note (10 seconds)` : t`Add a voice hello (10 seconds)`}
      maxMs={HELLO_MS}
      refusedText={t`Vela needs the microphone for a voice hello. You can allow it in Settings.`}
      onRecorded={onChange}
    />
  );
}
