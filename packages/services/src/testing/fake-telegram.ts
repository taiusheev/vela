/**
 * A recording `ChannelAdapter` that stands in for Telegram: every send gets message ids that count
 * up per conversation, as Telegram's do, and a test can make the next sends, or every send to one
 * conversation, fail with a chosen `ChannelSendError`. A stored file the gateway handed over is
 * recorded as the upload it would be, and one it did not hand over is refused, as the real adapter
 * refuses it (ADR-33).
 */
import {
  type AdapterCapabilities,
  type ChannelAdapter,
  ChannelSendError,
  type ChannelSendErrorCode,
  type FetchedMedia,
  type InboundEvent,
  type OutboundMessage,
  type SendResult,
} from "@vela/contracts";
import type { Clock } from "../deps.ts";

export interface SentMessage {
  readonly message: OutboundMessage;
  readonly result: SendResult;
  readonly at: Date;
  /** The stored files uploaded with it, in the message's order: each one's key and bytes. */
  readonly uploads: readonly { readonly storageKey: string; readonly file: FetchedMedia }[];
}

export interface FailedSend {
  readonly message: OutboundMessage;
  readonly code: ChannelSendErrorCode;
  readonly at: Date;
}

export interface ClosedButtons {
  readonly conversationId: string;
  readonly messageId: string;
  readonly replacementText: string | undefined;
}

export interface AcknowledgedTap {
  readonly eventId: string;
  readonly callbackId: string | undefined;
  readonly text: string | undefined;
}

export interface FailureOptions {
  readonly retryAfterSeconds?: number;
  readonly migratedToConversationId?: string;
}

export interface FakeTelegram extends ChannelAdapter {
  readonly sent: readonly SentMessage[];
  readonly failed: readonly FailedSend[];
  readonly closed: readonly ClosedButtons[];
  readonly acknowledged: readonly AcknowledgedTap[];
  readonly fetched: readonly string[];
  /** What `fetchMedia` returns per provider file id; unknown ids get a small octet stream. */
  readonly mediaFiles: Map<string, FetchedMedia>;
  sentTo(conversationId: string): SentMessage[];
  /** The next `count` sends fail with `code`; a conversation rule (below) is checked first. */
  failNextSends(count: number, code: ChannelSendErrorCode, options?: FailureOptions): void;
  /** Every send to the conversation fails with `code` until `clearFailures`. */
  failSendsTo(conversationId: string, code: ChannelSendErrorCode, options?: FailureOptions): void;
  clearFailures(): void;
  reset(): void;
}

const CAPABILITIES: AdapterCapabilities = {
  buttons: true,
  voiceIn: true,
  voiceOut: true,
  readReceipts: false,
  reactions: true,
  albums: true,
};

interface FailureRule {
  readonly code: ChannelSendErrorCode;
  readonly options: FailureOptions;
}

export function createFakeTelegram(clock: Clock): FakeTelegram {
  const sent: SentMessage[] = [];
  const failed: FailedSend[] = [];
  const closed: ClosedButtons[] = [];
  const acknowledged: AcknowledgedTap[] = [];
  const fetched: string[] = [];
  const mediaFiles = new Map<string, FetchedMedia>();
  const nextIds = new Map<string, number>();
  const perConversation = new Map<string, FailureRule>();
  let nextFailures: { remaining: number; rule: FailureRule } | null = null;

  function nextMessageId(conversationId: string): string {
    const id = nextIds.get(conversationId) ?? 1;
    nextIds.set(conversationId, id + 1);
    return String(id);
  }

  function failureFor(conversationId: string): FailureRule | null {
    const rule = perConversation.get(conversationId);
    if (rule !== undefined) {
      return rule;
    }
    if (nextFailures !== null && nextFailures.remaining > 0) {
      nextFailures.remaining -= 1;
      return nextFailures.rule;
    }
    return null;
  }

  return {
    id: "telegram",
    capabilities: CAPABILITIES,
    sent,
    failed,
    closed,
    acknowledged,
    fetched,
    mediaFiles,

    async verify() {
      return true;
    },

    parse() {
      return [];
    },

    async send(message, files) {
      const conversationId = message.to.conversationId;
      const uploads = (message.media ?? []).flatMap((ref) => {
        if (ref.providerFileId !== undefined || ref.url !== undefined) return [];
        const file = ref.storageKey === undefined ? undefined : files?.get(ref.storageKey);
        if (ref.storageKey === undefined || file === undefined) {
          throw new ChannelSendError(
            "invalid_request",
            "fake telegram: a stored file was not loaded",
          );
        }
        return [{ storageKey: ref.storageKey, file }];
      });
      const rule = failureFor(conversationId);
      if (rule !== null) {
        failed.push({ message, code: rule.code, at: clock.now() });
        throw new ChannelSendError(rule.code, `fake telegram: ${rule.code}`, {
          retryAfterSeconds: rule.options.retryAfterSeconds,
          migratedToConversationId: rule.options.migratedToConversationId,
        });
      }
      // Telegram creates one message per media item, then the text with the buttons.
      const mediaIds = (message.media ?? []).map(() => nextMessageId(conversationId));
      const primaryMessageId = nextMessageId(conversationId);
      const result: SendResult = {
        externalMessageIds: [...mediaIds, primaryMessageId],
        primaryMessageId,
      };
      sent.push({ message, result, at: clock.now(), uploads });
      return result;
    },

    async acknowledgeButton(event: InboundEvent, text?: string) {
      acknowledged.push({ eventId: event.eventId, callbackId: event.callbackId, text });
    },

    async closeButtons(conversationId, messageId, replacementText) {
      closed.push({ conversationId, messageId, replacementText });
    },

    async fetchMedia(providerFileId) {
      fetched.push(providerFileId);
      return (
        mediaFiles.get(providerFileId) ?? {
          body: new TextEncoder().encode(providerFileId).buffer as ArrayBuffer,
          mime: "application/octet-stream",
        }
      );
    },

    sentTo: (conversationId) =>
      sent.filter((entry) => entry.message.to.conversationId === conversationId),

    failNextSends: (count, code, options = {}) => {
      nextFailures = { remaining: count, rule: { code, options } };
    },

    failSendsTo: (conversationId, code, options = {}) => {
      perConversation.set(conversationId, { code, options });
    },

    clearFailures: () => {
      perConversation.clear();
      nextFailures = null;
    },

    reset: () => {
      sent.length = 0;
      failed.length = 0;
      closed.length = 0;
      acknowledged.length = 0;
      fetched.length = 0;
      mediaFiles.clear();
      nextIds.clear();
      perConversation.clear();
      nextFailures = null;
    },
  };
}
