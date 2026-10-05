import { Trans, useLingui } from "@lingui/react/macro";
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useAccount } from "../auth/clerk.tsx";
import { SecondaryButton, Words } from "../components/ui.tsx";
import { audioCache, registerAudioStop, stopOtherAudio } from "./cache.ts";
import { clock } from "./useRecording.ts";

export interface VoicePlaybackProps {
  familyId: string;
  mediaId: string;
  mime?: string;
  durationMs?: number | null;
  expiresAt?: string | null;
  ready?: boolean;
  state?: "pending" | "ready" | "unavailable";
  label?: string;
}

/** The same authenticated original recording on Today, Exchanges and the family book. */
export function VoicePlayback({
  familyId,
  mediaId,
  durationMs,
  expiresAt,
  ready = true,
  state,
  label,
}: VoicePlaybackProps) {
  const { t } = useLingui();
  const account = useAccount();
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const alive = useRef(true);
  const attempt = useRef(0);
  const uri = useRef<string | null>(null);
  const stop = useRef(() => {
    player.pause();
  });
  stop.current = () => {
    attempt.current += 1;
    try {
      player.pause();
    } catch {
      /* The Expo hook may already have released it on unmount. */
    }
    if (alive.current) setLoading(false);
  };
  const stableStop = useRef(() => stop.current()).current;
  // biome-ignore lint/correctness/useExhaustiveDependencies: Dispose playback on family, media and account changes.
  useEffect(() => {
    alive.current = true;
    setLoading(false);
    setFailed(false);
    const unregister = registerAudioStop(stableStop);
    return () => {
      alive.current = false;
      attempt.current += 1;
      unregister();
      try {
        player.pause();
      } catch {
        /* The Expo hook may already have released it on unmount. */
      }
      const previousUri = uri.current;
      uri.current = null;
      if (previousUri !== null) void audioCache.release(previousUri).catch(() => {});
    };
  }, [stableStop, familyId, mediaId, account.userId]);

  const listen = async () => {
    if (status.playing) {
      player.pause();
      return;
    }
    const currentAttempt = ++attempt.current;
    setLoading(true);
    setFailed(false);
    try {
      stopOtherAudio(stableStop);
      player.pause();
      const prepared = await audioCache.prepare(account, familyId, mediaId, expiresAt);
      if (!alive.current || attempt.current !== currentAttempt) {
        await audioCache.release(prepared);
        return;
      }
      if (uri.current !== null) await audioCache.release(uri.current);
      uri.current = prepared;
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      if (!alive.current || attempt.current !== currentAttempt) {
        await audioCache.release(prepared);
        return;
      }
      player.replace({ uri: prepared });
      player.play();
    } catch {
      if (alive.current && attempt.current === currentAttempt) setFailed(true);
    } finally {
      if (alive.current && attempt.current === currentAttempt) setLoading(false);
    }
  };
  const expired = expiresAt != null && Date.parse(expiresAt) <= Date.now();
  const availability = state ?? (ready ? "ready" : "pending");
  return (
    <View>
      <SecondaryButton
        label={
          loading
            ? t`Loading voice…`
            : status.playing
              ? t`Pause voice`
              : (label ?? t`Listen to the original voice`)
        }
        disabled={
          !status.playing && (loading || availability !== "ready" || expired || !account.signedIn)
        }
        onPress={() => void listen()}
      />
      {availability !== "pending" || expired ? null : (
        <Words variant="caption" tone="ink3">
          <Trans>The voice is still being prepared. Try again shortly.</Trans>
        </Words>
      )}
      {availability === "unavailable" || expired ? (
        <Words variant="caption" tone="ink3">
          <Trans>This voice is no longer available.</Trans>
        </Words>
      ) : failed ? (
        <Words variant="caption" tone="ink3">
          <Trans>That voice could not be opened. Try again in a moment.</Trans>
        </Words>
      ) : null}
      {durationMs == null ? null : (
        <Words variant="caption" tone="ink3">
          {clock(durationMs)}
        </Words>
      )}
    </View>
  );
}
