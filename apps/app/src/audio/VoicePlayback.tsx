import { Trans, useLingui } from "@lingui/react/macro";
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useAccount } from "../auth/clerk.tsx";
import { Words } from "../components/ui.tsx";
import { space } from "../theme/tokens.ts";
import { audioCache, registerAudioStop, stopOtherAudio } from "./cache.ts";
import { type Rate, VoiceBar } from "./voice-bar.tsx";

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

/**
 * The same authenticated original recording on Today, Memories, the chat and the family book, as a
 * messenger plays a voice: play and pause, the time, a tap to jump, and 1×, 1.5× or 2×.
 */
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
  const [rate, setRate] = useState<Rate>(1);
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

  // The voice fetched for this player is kept while it is on screen: pause, play again and a
  // replay go straight to the player, and only a first play (or one after a failure) fetches it.
  const prepare = async (currentAttempt: number): Promise<boolean> => {
    if (uri.current !== null) return true;
    const prepared = await audioCache.prepare(account, familyId, mediaId, expiresAt);
    if (!alive.current || attempt.current !== currentAttempt) {
      await audioCache.release(prepared);
      return false;
    }
    uri.current = prepared;
    player.replace({ uri: prepared });
    return true;
  };

  const listen = async () => {
    if (status.playing) {
      player.pause();
      return;
    }
    const currentAttempt = ++attempt.current;
    setFailed(false);
    if (uri.current === null) setLoading(true);
    try {
      stopOtherAudio(stableStop);
      if (!(await prepare(currentAttempt))) return;
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      if (!alive.current || attempt.current !== currentAttempt) return;
      // A voice played to its end starts again from the beginning.
      if (status.duration > 0 && status.currentTime >= status.duration - 0.05)
        await player.seekTo(0);
      player.setPlaybackRate(rate);
      player.play();
    } catch {
      if (alive.current && attempt.current === currentAttempt) {
        setFailed(true);
        const previous = uri.current;
        uri.current = null;
        if (previous !== null) void audioCache.release(previous).catch(() => {});
      }
    } finally {
      if (alive.current && attempt.current === currentAttempt) setLoading(false);
    }
  };
  const expired = expiresAt != null && Date.parse(expiresAt) <= Date.now();
  const availability = state ?? (ready ? "ready" : "pending");
  const totalMs = status.duration > 0 ? Math.round(status.duration * 1_000) : (durationMs ?? null);
  const elapsedMs = Math.round(status.currentTime * 1_000);
  const finished = status.duration > 0 && status.currentTime >= status.duration - 0.05;
  return (
    <View style={{ gap: space.xs }}>
      <VoiceBar
        playing={status.playing}
        loading={loading}
        disabled={
          !status.playing && (loading || availability !== "ready" || expired || !account.signedIn)
        }
        progress={totalMs !== null && totalMs > 0 && !finished ? elapsedMs / totalMs : 0}
        elapsedMs={finished ? 0 : elapsedMs}
        totalMs={totalMs}
        rate={rate}
        label={label ?? t`Play the voice`}
        onToggle={() => void listen()}
        onSeek={
          uri.current === null || totalMs === null
            ? undefined
            : (fraction) => void player.seekTo((fraction * totalMs) / 1_000)
        }
        onRate={(next) => {
          setRate(next);
          player.setPlaybackRate(next);
        }}
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
    </View>
  );
}
