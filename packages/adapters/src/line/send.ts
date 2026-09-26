/**
 * Renders an `OutboundMessage` as LINE message objects and sends them (05 §5.5): media first, in
 * order, then the text, then, where the buttons must outlast the next message, a Flex bubble
 * holding them.
 *
 * LINE takes at most five objects per request and bills a push once per recipient however many it
 * holds, so objects go five to a request. Every push carries a retry key derived from the outbound
 * row's idempotency key, and the body is a pure function of the message, so a gateway retry sends
 * the same bytes and LINE answers a request it already accepted with 409 and the first ids. A reply
 * is free but single-use and takes no key, so it is used only for a message that fits one request.
 *
 * LINE interprets no markup in a text message, so the text goes as it is.
 */
import {
  type Button,
  ChannelSendError,
  type MediaKind,
  type MediaRef,
  type OutboundKind,
  OutboundMessage,
  type SendResult,
} from "@vela/contracts";
import type {
  LineClient,
  LineMessageObject,
  LinePostbackAction,
  LineQuickReplyItem,
} from "./client.ts";
import { CONVERSATION_ID, USER_ID } from "./ids.ts";
import { mediaTypeOf } from "./media.ts";
import { lineRetryKey } from "./retry-key.ts";

const MAX_OBJECTS_PER_REQUEST = 5;
const MAX_QUICK_REPLY_ITEMS = 13;
/** Labels count grapheme clusters, so an emoji family is one. */
const QUICK_REPLY_LABEL_GRAPHEMES = 20;
const FLEX_LABEL_GRAPHEMES = 40;
/** Counted in UTF-16 code units, as LINE counts every field but labels and `displayText`. */
const MAX_ALT_TEXT_UNITS = 1_500;
const MAX_MEDIA_URL_LENGTH = 2_000;
/** LINE says "MB"; the decimal reading is the smaller, so it is the one that always fits. */
const MAX_IMAGE_BYTES = 10_000_000;
const MAX_PREVIEW_BYTES = 1_000_000;
const MAX_AUDIO_BYTES = 200_000_000;
const IMAGE_MIMES: ReadonlySet<string> = new Set(["image/jpeg", "image/png"]);
/** m4a under each name it goes by, and mp3. */
const AUDIO_MIMES: ReadonlySet<string> = new Set([
  "audio/mp4",
  "audio/x-m4a",
  "audio/m4a",
  "audio/mpeg",
]);
/**
 * A quick reply vanishes when anyone sends a new message. Her consent is answered when she is
 * ready, whatever she typed before (04 §3.2), and a quiet notice's buttons wait for an organiser,
 * so both keep theirs in a Flex bubble. So does anything sent to a group, where the next message
 * from anyone would take them from everyone.
 */
const PERSISTENT_BUTTON_KINDS: ReadonlySet<OutboundKind> = new Set(["consent", "quiet_notice"]);
const ELLIPSIS = "…";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** What LINE needs to send one media item, however the item names it. */
interface OutboundMedia {
  readonly kind: MediaKind;
  readonly url: string;
  /** A smaller copy of an image made when it was stored; none exists yet (build plan 3.4). */
  readonly previewUrl?: string;
  readonly mime: string;
  readonly durationMs?: number;
  readonly bytes?: number;
}

export interface LinePlan {
  /** Each request's objects, at most five, in the order they are sent. */
  readonly requests: readonly (readonly LineMessageObject[])[];
  /** The text's place among all the objects: its id is the `primaryMessageId`. */
  readonly textIndex: number;
}

export async function sendLineMessage(
  client: LineClient,
  message: OutboundMessage,
): Promise<SendResult> {
  const checked = OutboundMessage.safeParse(message);
  if (!checked.success) {
    const fields = checked.error.issues.map((issue) => issue.path.join(".") || "message");
    throw refused(`outbound message is invalid: ${fields.join(", ")}`);
  }
  const outbound = checked.data;
  if (outbound.to.channel !== "line") {
    throw refused(`cannot send a ${outbound.to.channel} message on line`);
  }
  if (!CONVERSATION_ID.test(outbound.to.conversationId)) {
    throw refused("conversation id is not a LINE user, group or room id");
  }

  // Everything that can be refused locally is refused while planning, before the first request,
  // so a bad message never leaves half of itself delivered.
  const plan = planLineRequests(outbound);
  const ids = await deliver(client, outbound, plan.requests);
  const primaryMessageId = ids[plan.textIndex];
  if (primaryMessageId === undefined) {
    throw new ChannelSendError("unknown", "line returned no id for the text message");
  }
  return { externalMessageIds: ids, primaryMessageId };
}

/** The requests a message becomes. Throws `invalid_request` for anything LINE would refuse. */
export function planLineRequests(message: OutboundMessage): LinePlan {
  const media = (message.media ?? []).map(mediaObject);
  const buttons = (message.buttons ?? []).flat();
  const persistent =
    buttons.length > 0 &&
    (PERSISTENT_BUTTON_KINDS.has(message.kind) ||
      !USER_ID.test(message.to.conversationId) ||
      // Past LINE's 13 quick replies the bubble costs nothing more in the same request, where a
      // refusal would fail the send.
      buttons.length > MAX_QUICK_REPLY_ITEMS);
  const text: LineMessageObject =
    buttons.length === 0 || persistent
      ? { type: "text", text: message.text }
      : { type: "text", text: message.text, quickReply: { items: buttons.map(quickReplyItem) } };
  // LINE quotes by quote token, which Vela does not keep, so `replyToMessageId` is not sent.
  const objects = [...media, text, ...(persistent ? [buttonBubble(buttons)] : [])];
  const requests: LineMessageObject[][] = [];
  for (let start = 0; start < objects.length; start += MAX_OBJECTS_PER_REQUEST) {
    requests.push(objects.slice(start, start + MAX_OBJECTS_PER_REQUEST));
  }
  return { requests, textIndex: media.length };
}

/**
 * Fits a label to LINE's limit in grapheme clusters, as LINE counts labels, ending in an ellipsis
 * when cut. The whole label still reaches the chat as the button's `displayText`.
 */
export function fitLabel(label: string, maxGraphemes: number): string {
  const parts = Array.from(graphemes.segment(label), (part) => part.segment);
  if (parts.length <= maxGraphemes) return label;
  const kept = parts.slice(0, maxGraphemes - 1).join("");
  return `${kept.trimEnd()}${ELLIPSIS}`;
}

async function deliver(
  client: LineClient,
  outbound: OutboundMessage,
  requests: readonly (readonly LineMessageObject[])[],
): Promise<string[]> {
  const [only, ...more] = requests;
  if (outbound.replyToken !== undefined && only !== undefined && more.length === 0) {
    const reply = await client.reply({ replyToken: outbound.replyToken, messages: only });
    if (reply.accepted) return [...reply.sentMessageIds];
    // LINE refused the token as used, expired or unknown: nothing went out, so a push is safe.
  }
  const ids: string[] = [];
  for (const [index, messages] of requests.entries()) {
    const retryKey = await lineRetryKey(outbound.idempotencyKey, index);
    ids.push(...(await client.push({ to: outbound.to.conversationId, messages }, retryKey)));
  }
  return ids;
}

function mediaObject(ref: MediaRef): LineMessageObject {
  const media = resolveMedia(ref);
  return media.kind === "image" ? imageObject(media) : audioObject(media);
}

/**
 * Where LINE fetches one media item, and what it must know about it. LINE takes media only as an
 * HTTPS URL and cannot re-send a file by its id (05 §1 fact 14). Until photo-asks brings stored
 * objects to the contract the URL is the reference's own; then only this function changes, to ask
 * the Worker for the signed URL of the storage key.
 */
function resolveMedia(ref: MediaRef): OutboundMedia {
  if (ref.url === undefined) {
    throw refused("LINE cannot send a file by its platform id; it needs a URL");
  }
  let url: URL;
  try {
    url = new URL(ref.url);
  } catch {
    throw refused("media URL is not a URL");
  }
  if (url.protocol !== "https:") throw refused("LINE fetches media only over HTTPS");
  // `href` is the URL percent-encoded in UTF-8, as LINE requires, and the same on every attempt.
  if (url.href.length > MAX_MEDIA_URL_LENGTH) {
    throw refused(`media URL exceeds LINE's ${MAX_MEDIA_URL_LENGTH} characters`);
  }
  const mime = mediaTypeOf(ref.mime);
  if (mime === undefined) throw refused("a media item needs its MIME type on LINE");
  return {
    kind: ref.kind,
    url: url.href,
    mime,
    ...(ref.durationMs !== undefined && { durationMs: ref.durationMs }),
    ...(ref.bytes !== undefined && { bytes: ref.bytes }),
  };
}

function imageObject(media: OutboundMedia): LineMessageObject {
  if (!IMAGE_MIMES.has(media.mime)) throw refused("LINE sends images only as JPEG or PNG");
  if (media.bytes !== undefined && media.bytes > MAX_IMAGE_BYTES) {
    throw refused("an image over 10 MB cannot go on LINE");
  }
  // The preview is at most 1 MB. An original of unknown size may be larger, so it serves as its own
  // preview only when it is known to fit.
  const previewImageUrl =
    media.previewUrl ??
    (media.bytes !== undefined && media.bytes <= MAX_PREVIEW_BYTES ? media.url : undefined);
  if (previewImageUrl === undefined) {
    throw refused("an image over 1 MB, or of unknown size, needs a preview on LINE");
  }
  return { type: "image", originalContentUrl: media.url, previewImageUrl };
}

function audioObject(media: OutboundMedia): LineMessageObject {
  if (!AUDIO_MIMES.has(media.mime)) throw refused("LINE plays audio only as m4a or mp3");
  if (media.durationMs === undefined) throw refused("LINE needs an audio message's duration");
  if (media.bytes !== undefined && media.bytes > MAX_AUDIO_BYTES) {
    throw refused("audio over 200 MB cannot go on LINE");
  }
  return { type: "audio", originalContentUrl: media.url, duration: media.durationMs };
}

function quickReplyItem(button: Button): LineQuickReplyItem {
  return { type: "action", action: postback(button, QUICK_REPLY_LABEL_GRAPHEMES) };
}

/**
 * One button per line: two long labels side by side are cut off on a phone. The alt text stands
 * for the bubble in notifications and the chat list.
 */
function buttonBubble(buttons: readonly Button[]): LineMessageObject {
  return {
    type: "flex",
    altText: fitUnits(buttons.map((button) => button.label).join(" · "), MAX_ALT_TEXT_UNITS),
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: buttons.map((button) => ({
          type: "button",
          style: "secondary",
          height: "sm",
          action: postback(button, FLEX_LABEL_GRAPHEMES),
        })),
      },
    },
  };
}

/**
 * `data` is the button id, at most 64 characters against LINE's 300. The whole label, at most 64
 * against LINE's 300, is the `displayText` the tap posts, since a fitted label may have been cut.
 */
function postback(button: Button, maxLabelGraphemes: number): LinePostbackAction {
  return {
    type: "postback",
    label: fitLabel(button.label, maxLabelGraphemes),
    data: button.id,
    displayText: button.label,
  };
}

/** Cuts text to LINE's limit in UTF-16 code units, never inside a grapheme, so no emoji is split. */
function fitUnits(text: string, maxUnits: number): string {
  if (text.length <= maxUnits) return text;
  let kept = "";
  for (const { segment } of graphemes.segment(text)) {
    if (kept.length + segment.length > maxUnits - ELLIPSIS.length) break;
    kept += segment;
  }
  return `${kept.trimEnd()}${ELLIPSIS}`;
}

function refused(reason: string): ChannelSendError {
  return new ChannelSendError("invalid_request", reason);
}
