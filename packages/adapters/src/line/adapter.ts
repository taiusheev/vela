import {
  type AdapterCapabilities,
  type ChannelAdapter,
  type ChannelProfile,
  ChannelSendError,
} from "@vela/contracts";
import { createLineClient, type LineApiOptions, type LineClient } from "./client.ts";
import { GROUP_ID, ROOM_ID, USER_ID } from "./ids.ts";
import { fetchLineMedia, fetchLinePreview, type Wait } from "./media.ts";
import { parseLineWebhook } from "./parse.ts";
import { readLineQuota } from "./quota.ts";
import { sendLineMessage } from "./send.ts";
import { createLineSignatureVerifier } from "./verify.ts";

export interface LineAdapterOptions extends LineApiOptions {
  /** The channel secret, which keys the webhook signature. */
  readonly channelSecret: string;
  /**
   * Starts each reply token's minute and dates quota readings. Defaults to the system clock; tests
   * pass a fixed one.
   */
  readonly now?: () => Date;
  /**
   * Waits between polls while LINE prepares a large voice note. Defaults to a timer; tests pass one
   * that records the wait and resolves at once.
   */
  readonly wait?: Wait;
}

const LINE_CAPABILITIES: AdapterCapabilities = {
  buttons: true,
  voiceIn: true,
  voiceOut: true,
  readReceipts: false,
  reactions: false,
  // Images go as separate objects, which LINE shows one after another.
  albums: false,
  // Nothing sent can be changed afterwards (05 §1 fact 11).
  editMessages: false,
  // LINE sends media only by HTTPS URL (fact 14).
  resendsProviderFiles: false,
  mediaByUrl: true,
  // LINE quotes only text and stickers (fact 12).
  mediaReplies: false,
};

/** Visible ASCII, as the access token must be: LINE documents no shape for the secret either. */
const SECRET_PATTERN = /^[\x21-\x7e]+$/;

const sleep: Wait = (milliseconds) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

export function createLineAdapter(options: LineAdapterOptions): ChannelAdapter {
  if (!SECRET_PATTERN.test(options.channelSecret)) {
    throw new Error("LINE channel secret must be visible ASCII without spaces");
  }
  const client = createLineClient(options);
  const verifySignature = createLineSignatureVerifier(options.channelSecret);
  const now = options.now ?? (() => new Date());
  const wait = options.wait ?? sleep;

  return {
    id: "line",
    capabilities: LINE_CAPABILITIES,

    // `destination` in the body is not checked: the signature already binds the body to this
    // channel's secret, and each environment has a channel of its own.
    verify(input) {
      return verifySignature(input.headers, input.rawBody);
    },

    parse(input) {
      return parseLineWebhook(input.rawBody, now());
    },

    send(message) {
      return sendLineMessage(client, message);
    },

    // A postback shows no spinner, so there is nothing to stop. Four flows call this without a
    // catch, so it resolves for any event.
    async acknowledgeButton() {},

    // `editMessages` is false: LINE cannot change a message once sent, so this does nothing.
    async closeButtons() {},

    fetchMedia(providerFileId) {
      return fetchLineMedia(client, providerFileId, wait);
    },

    fetchPreview(providerFileId) {
      return fetchLinePreview(client, providerFileId);
    },

    profile(externalUserId, conversationId) {
      return readProfile(client, externalUserId, conversationId);
    },

    leaveConversation(conversationId) {
      return leaveConversation(client, conversationId);
    },

    quota() {
      return readLineQuota(client, now);
    },
  };
}

/**
 * A group's members are asked through the group, which answers whether or not they added or
 * blocked the account, and gives no language. Anyone else is asked for their main profile, which
 * gives the language once they agreed to LY Corporation's privacy policy.
 */
async function readProfile(
  client: LineClient,
  userId: string,
  conversationId: string | undefined,
): Promise<ChannelProfile | null> {
  if (conversationId === undefined || USER_ID.test(conversationId)) {
    const profile = await client.profile(userId);
    if (profile === null) return null;
    return {
      ...(profile.displayName !== undefined && { displayName: profile.displayName }),
      ...(profile.language !== undefined && { languageCode: profile.language }),
    };
  }
  if (GROUP_ID.test(conversationId)) return client.groupMemberProfile(conversationId, userId);
  // Multi-person chats predate groups and Vela links none (05 §3.1), so no one there is looked up.
  if (ROOM_ID.test(conversationId)) return null;
  throw new ChannelSendError("invalid_request", "conversation id is not a LINE id");
}

async function leaveConversation(client: LineClient, conversationId: string): Promise<void> {
  if (GROUP_ID.test(conversationId)) return client.leaveGroup(conversationId);
  if (ROOM_ID.test(conversationId)) return client.leaveRoom(conversationId);
  // A person's own chat cannot be left; only they can end it, by blocking the account.
  throw new ChannelSendError("invalid_request", "only a LINE group or room can be left");
}
