import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiDeviceMessage } from "@vela/contracts";
import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  apiBaseUrl,
  apiConfigured,
  fetchDeviceMember,
  fetchDeviceMessages,
  sendDeviceMessage,
} from "../api/client.ts";
import { fetchDevicePhoto, uploadDeviceVoice } from "../api/upload.ts";
import { loadPhoto } from "../data/photos.ts";
import { photosToCycle } from "./kitchen.ts";
import { scheduleHerMorning } from "./morning.ts";
import { clearDeviceToken, readDeviceToken } from "./token.ts";

/** How often her phone looks for a new message while the screen is open. */
const REFRESH_MS = 60_000;
/** After she sends something, Vela's answer is usually there within a few seconds. */
const AFTER_SEND_MS = 3_000;

export interface ParentView {
  /** Still reading the token or her first message. */
  loading: boolean;
  /** Set up, and still hers: false once the phone was set up again elsewhere or removed. */
  linked: boolean;
  /** How Vela greets her, for the line above the message. */
  name: string;
  /** Her language, which the message is in and is read aloud in. */
  language: string;
  /** Vela's newest message to her, which the screen shows and reads aloud. */
  message: ApiDeviceMessage | null;
  /** Loads one photo of her message as a `data:` URI; undefined in the demo, which has none. */
  photo?: (mediaId: string) => Promise<string>;
  /** The family's photos in her latest messages, newest first, for the kitchen table to cycle. */
  cycle: string[];
  /** Where the phone plays one voice note of her message from, with her token; not in the demo. */
  voice?: (mediaId: string) => { uri: string; headers: Record<string, string> };
  sending: boolean;
  /** Why the last tap or words did not go, in words for the screen. */
  trouble?: string;
  tap(buttonId: string): void;
  say(words: string): Promise<boolean>;
  /** Her recording, uploaded under its key and sent as her voice; false when it did not go. */
  sendVoice(recording: { uri: string; key: string; durationMs: number }): Promise<boolean>;
}

/** The demo's morning, so the parent screen can be seen and walked without a phone set up. */
function exampleMorning(): ApiDeviceMessage {
  return {
    message_id: "example-1",
    kind: "arrival",
    exchange_id: null,
    text: t`Good morning, Mom. Mia asks: what did you have for breakfast?`,
    buttons: [
      [{ id: "example:porridge", label: t`Rice porridge` }],
      [{ id: "example:toast", label: t`Toast and tea` }],
      [{ id: "example:fine", label: t`❤️ I'm fine` }],
    ],
    photos: [],
    voices: [],
    sent_at: new Date().toISOString(),
  };
}

function exampleThanks(): ApiDeviceMessage {
  return {
    message_id: "example-2",
    kind: "system",
    exchange_id: null,
    text: t`Thank you. Mia knows you're fine.`,
    buttons: [],
    photos: [],
    voices: [],
    sent_at: new Date().toISOString(),
  };
}

/**
 * Her phone on the parent surface (ADR-35, spec §14.2): the token this phone keeps, who it is for,
 * and Vela's newest message to her, read again every minute and soon after she says something.
 * A phone with no API shows the demo's morning and answers itself.
 */
export function useParent(): ParentView {
  useLingui();
  const queries = useQueryClient();
  const demo = !apiConfigured();
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [answered, setAnswered] = useState(false);
  const [trouble, setTrouble] = useState<string | undefined>();

  useEffect(() => {
    let current = true;
    void readDeviceToken().then((stored) => {
      if (current) setToken(stored);
    });
    return () => {
      current = false;
    };
  }, []);

  const live = !demo && typeof token === "string";
  const member = useQuery({
    queryKey: ["device", "member"],
    enabled: live,
    queryFn: () => fetchDeviceMember(token ?? ""),
    retry: false,
  });
  const messages = useQuery({
    queryKey: ["device", "messages"],
    enabled: live && member.isSuccess,
    queryFn: () => fetchDeviceMessages(token ?? ""),
    refetchInterval: REFRESH_MS,
  });
  const unlinked = member.error instanceof ApiError && member.error.status === 401;
  // Her phone tells her each morning that her message is there, at her own arrival time.
  const arrival = member.data?.arrival_time ?? null;
  useEffect(() => {
    if (arrival !== null) {
      void scheduleHerMorning(arrival, {
        body: t`Good morning. Your message is here.`,
        channel: t`Your morning message`,
      });
    }
  }, [arrival]);
  useEffect(() => {
    if (unlinked) void clearDeviceToken();
  }, [unlinked]);

  const send = useMutation({
    mutationFn: (
      input: { button: string; message_id: string } | { text: string } | { voice: string },
    ) => sendDeviceMessage(token ?? "", input),
    onSuccess: () => {
      setTrouble(undefined);
      setTimeout(() => {
        void queries.invalidateQueries({ queryKey: ["device", "messages"] });
      }, AFTER_SEND_MS);
    },
    onError: () => setTrouble(t`That did not go through. Try again in a moment.`),
  });

  // One loader per token, so a photo on screen is not asked for again on every render.
  const photo = useCallback(
    (mediaId: string) =>
      loadPhoto(mediaId, () => fetchDevicePhoto(mediaId, typeof token === "string" ? token : "")),
    [token],
  );

  const voice = useCallback(
    (mediaId: string) => ({
      uri: `${apiBaseUrl ?? ""}/v1/device/media/${mediaId}`,
      headers: { authorization: `Device ${typeof token === "string" ? token : ""}` },
    }),
    [token],
  );

  if (demo) {
    return {
      loading: false,
      linked: true,
      name: t`Mom`,
      language: "en",
      message: answered ? exampleThanks() : exampleMorning(),
      cycle: [],
      sending: false,
      tap: () => setAnswered(true),
      say: async (words) => {
        if (words.trim().length === 0) return false;
        setAnswered(true);
        return true;
      },
      sendVoice: async () => {
        setAnswered(true);
        return true;
      },
    };
  }

  const newest = messages.data?.messages[0] ?? null;
  return {
    loading: token === undefined || (live && (member.isPending || messages.isPending)),
    linked: typeof token === "string" && !unlinked,
    name: member.data?.address_form ?? "",
    language: member.data?.language ?? "en",
    message: newest,
    photo,
    voice,
    cycle: photosToCycle(messages.data?.messages ?? []),
    sending: send.isPending,
    ...(trouble === undefined ? {} : { trouble }),
    tap(buttonId) {
      if (newest === null) return;
      send.mutate({ button: buttonId, message_id: newest.message_id });
    },
    async sendVoice(recording) {
      if (typeof token !== "string") return false;
      try {
        const voice = await uploadDeviceVoice(
          recording.uri,
          recording.key,
          recording.durationMs,
          token,
        );
        await send.mutateAsync({ voice });
        return true;
      } catch {
        setTrouble(t`That did not go through. Try again in a moment.`);
        return false;
      }
    },
    async say(words) {
      const text = words.trim();
      if (text.length === 0) return false;
      try {
        await send.mutateAsync({ text });
        return true;
      } catch {
        return false;
      }
    },
  };
}
