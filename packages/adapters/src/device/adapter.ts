import type {
  AdapterCapabilities,
  ChannelAdapter,
  FetchedMedia,
  InboundEvent,
  OutboundMessage,
  SendResult,
} from "@vela/contracts";
import { ChannelSendError } from "@vela/contracts";

/**
 * Her phone on the parent surface (ADR-35). Nothing is sent over a network: her app reads her
 * morning from the API when she opens it, so a send here succeeds at once with a fresh message id,
 * and the gateway's delivery effects (`delivered_at`, the read-back mark, `message_refs`) are
 * written as for any channel, which keeps the budget, idempotency and the quiet ladder's measure
 * of her silence exactly as they are on Telegram. Her taps come through her own API routes, never
 * a webhook, so there is nothing to verify or parse, and nothing to acknowledge or close.
 */
const CAPABILITIES: AdapterCapabilities = {
  buttons: true,
  voiceIn: true,
  voiceOut: true,
  readReceipts: true,
  reactions: false,
  albums: true,
  editMessages: false,
  resendsProviderFiles: false,
  // Her app loads a stored photo through the API, so the gateway never loads its bytes for her.
  mediaByUrl: true,
  mediaReplies: true,
};

export interface DeviceAdapterOptions {
  /** A unique message id per send; `crypto.randomUUID` unless a test gives its own. */
  readonly messageId?: () => string;
}

export function createDeviceAdapter(options: DeviceAdapterOptions = {}): ChannelAdapter {
  const messageId = options.messageId ?? (() => crypto.randomUUID());
  return {
    id: "device",
    capabilities: CAPABILITIES,
    async verify() {
      return false;
    },
    parse() {
      return [];
    },
    async send(_message: OutboundMessage): Promise<SendResult> {
      const id = messageId();
      return { externalMessageIds: [id], primaryMessageId: id };
    },
    async acknowledgeButton(_event: InboundEvent) {},
    async closeButtons() {},
    async fetchMedia(): Promise<FetchedMedia> {
      throw new ChannelSendError("not_found", "Her phone holds no platform files to fetch");
    },
  };
}
