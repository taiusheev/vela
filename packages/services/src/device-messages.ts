import type { ApiDeviceMessage, DeviceInput, InboundEvent } from "@vela/contracts";
import { channelLinks, type Member, outbound } from "@vela/db";
import { and, desc, eq } from "drizzle-orm";
import type { Queryable } from "./repo.ts";

/** How many of her latest messages her phone is given: her morning, its read-back, a notice. */
const DEVICE_MESSAGES = 10;

interface StoredButton {
  id: string;
  label: string;
}

/**
 * What Vela sent her phone (ADR-35, phase 3), newest first: each `device` row the gateway sent to
 * her, with the text and buttons it was sent with. Her phone shows the newest and reads it aloud;
 * a tap on one of its buttons comes back with the button's id and this message's id, as a tap in a
 * Telegram chat does. A row whose payload retention has cleared has no text left and is skipped.
 */
export async function loadDeviceMessages(db: Queryable, her: Member): Promise<ApiDeviceMessage[]> {
  const rows = await db
    .select()
    .from(outbound)
    .where(
      and(
        eq(outbound.memberId, her.id),
        eq(outbound.channel, "device"),
        eq(outbound.status, "sent"),
      ),
    )
    .orderBy(desc(outbound.sentAt), desc(outbound.id))
    .limit(DEVICE_MESSAGES);
  return rows.flatMap((row) => {
    const message = (row.payload as { message?: { text?: unknown; buttons?: unknown } }).message;
    const text = typeof message?.text === "string" ? message.text : "";
    if (text.length === 0 || row.externalId === null || row.sentAt === null) return [];
    const buttons = Array.isArray(message?.buttons)
      ? (message.buttons as StoredButton[][]).map((line) =>
          line.map((button) => ({ id: button.id, label: button.label })),
        )
      : [];
    return [
      {
        message_id: row.externalId,
        kind: row.kind,
        exchange_id: row.exchangeId,
        text,
        buttons,
        sent_at: row.sentAt.toISOString(),
      },
    ];
  });
}

/**
 * Her tap or her words from her phone, as the inbound event a Telegram chat would make of them,
 * for `handleInbound` (ADR-35): she is the sender and the conversation is her phone, both named by
 * her `device` link's id, so the router finds her as it finds a Telegram user. A tap carries the
 * button's id and the id of the message it was under, which her consent and her answers read.
 */
export async function deviceInboundEvent(
  db: Queryable,
  her: Member,
  input: DeviceInput,
  ids: { eventId: string; messageId: string },
  at: Date,
): Promise<InboundEvent | null> {
  const [link] = await db
    .select({ externalId: channelLinks.externalId })
    .from(channelLinks)
    .where(and(eq(channelLinks.memberId, her.id), eq(channelLinks.channel, "device")))
    .limit(1);
  if (link === undefined) return null;
  const common = {
    channel: "device" as const,
    eventId: `device:${ids.eventId}`,
    at: at.toISOString(),
    sender: { externalUserId: link.externalId },
    conversation: { externalId: link.externalId, kind: "private" as const },
  };
  return "button" in input
    ? {
        ...common,
        kind: "button",
        messageId: input.message_id,
        buttonData: input.button,
        callbackId: ids.eventId,
      }
    : { ...common, kind: "text", messageId: ids.messageId, text: input.text };
}
