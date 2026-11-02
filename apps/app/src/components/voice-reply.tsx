import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import type { Recorded } from "../audio/useRecording.ts";
import { VoiceRecorder } from "./voice-recorder.tsx";

/**
 * A voice reply on one exchange (spec §14.1 A8): tap the microphone, then send at once, or stop to
 * listen first. What is sent goes up under the recording's own key and is then named by the reply,
 * so a retry is the same voice. Her next morning reads it back to her in the family's own voice.
 */
export function VoiceReply({
  disabled,
  send,
}: {
  disabled: boolean;
  send: (recording: Recorded) => Promise<boolean>;
}) {
  const { t } = useLingui();
  const [sending, setSending] = useState(false);
  return (
    <VoiceRecorder
      label={t`Reply with your voice`}
      disabled={disabled}
      sending={sending || disabled}
      refusedText={t`Vela needs the microphone for a voice reply. You can allow it in Settings.`}
      onSend={async (recording) => {
        setSending(true);
        try {
          return await send(recording);
        } finally {
          setSending(false);
        }
      }}
    />
  );
}
