import { ChannelSendError } from "@vela/contracts";
import { outbound } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { deliverOutbound, enqueueOutbound } from "./gateway.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { seedFamily } from "./testing/seed.ts";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
}, 60_000);
beforeEach(async () => {
  await h.reset();
});
afterAll(async () => {
  await h.close();
});

async function confirmation() {
  const seed = await seedFamily(h.db, { now: h.clock.now() });
  const result = await enqueueOutbound(h.deps, h.db, {
    kind: "consent",
    idempotencyKey: "completed-setup-confirmation",
    memberId: seed.member.id,
    channel: "telegram",
    conversationId: seed.memberLink.externalId,
    lang: "en",
    text: "Original setup text\n\nYes, that's fine\n\nYour first morning arrives tomorrow.",
    consentUpdateMessageId: "17",
    consentTextLength: "Original setup text".length,
  });
  if (!("outboundId" in result)) throw new Error("confirmation was not queued");
  return result.outboundId;
}

describe("completed Telegram setup", () => {
  it("edits the original message, retains a durable receipt, and does not create another bubble", async () => {
    const edit = vi.spyOn(h.telegram, "closeButtons");
    const id = await confirmation();
    await deliverOutbound(h.deps, id);
    expect(edit).toHaveBeenCalledWith(
      expect.any(String),
      "17",
      expect.stringContaining("Your first morning"),
      19,
    );
    expect(h.telegram.sent).toHaveLength(0);
    const [row] = await h.db.select().from(outbound).where(eq(outbound.id, id));
    expect(row).toMatchObject({ status: "sent", externalId: "17" });
    await deliverOutbound(h.deps, id);
    expect(edit).toHaveBeenCalledTimes(1);
    edit.mockRestore();
  });

  it("retries a temporary edit failure instead of sending a new setup bubble", async () => {
    const original = h.telegram.closeButtons.bind(h.telegram);
    const edit = vi
      .spyOn(h.telegram, "closeButtons")
      .mockRejectedValueOnce(new ChannelSendError("unavailable", "temporarily unavailable"))
      .mockImplementation(original);
    const id = await confirmation();
    await deliverOutbound(h.deps, id);
    expect(h.telegram.sent).toHaveLength(0);
    const [row] = await h.db.select().from(outbound).where(eq(outbound.id, id));
    expect(row?.status).toBe("queued");
    h.clock.advanceMinutes(5);
    await deliverOutbound(h.deps, id);
    expect(edit).toHaveBeenCalledTimes(2);
    expect(h.telegram.sent).toHaveLength(0);
    edit.mockRestore();
  });

  it("sends the confirmation if the parent has already deleted the setup message", async () => {
    const edit = vi
      .spyOn(h.telegram, "closeButtons")
      .mockRejectedValueOnce(
        new ChannelSendError("invalid_request", "Bad Request: message to edit not found"),
      );
    const id = await confirmation();
    await deliverOutbound(h.deps, id);
    expect(h.telegram.sent).toHaveLength(1);
    expect(h.telegram.sent[0]?.message.text).toContain("Your first morning");
    edit.mockRestore();
  });

  it("does not turn an ambiguous edit failure into a duplicate new message", async () => {
    const edit = vi
      .spyOn(h.telegram, "closeButtons")
      .mockRejectedValueOnce(new ChannelSendError("unknown", "connection lost"));
    const id = await confirmation();
    await deliverOutbound(h.deps, id);
    expect(h.telegram.sent).toHaveLength(0);
    const [pending] = await h.db.select().from(outbound).where(eq(outbound.id, id));
    expect(pending?.status).toBe("queued");
    edit.mockRestore();
  });
});
