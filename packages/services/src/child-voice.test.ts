import { createHash } from "node:crypto";
/**
 * Her messages name her child instead of "the family" or Vela's own "I" (founder, 3 November 2026:
 * she should feel she is talking to her child, not to a bot): Vela's mornings are signed for them,
 * the hint and her thanks name who will hear her, and nobody gone is ever named.
 */
import type { InboundEvent, LocalDate } from "@vela/contracts";
import { t } from "@vela/copy";
import { addDays, zonedInstant } from "@vela/core";
import { exchanges, invites, members } from "@vela/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deliverArrival } from "./arrivals.ts";
import type { OutboundJob } from "./deps.ts";
import { deliverOutbound } from "./gateway.ts";
import { handleInbound } from "./inbound/router.ts";
import { childOf } from "./repo.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { type SeededFamily, seedFamily } from "./testing/seed.ts";

/** An invite token's hash, as the services store it (migration 0038). */
const tokenHashOf = (value: string): string => createHash("sha256").update(value).digest("hex");

const TZ = "Asia/Taipei";
const TODAY: LocalDate = "2026-09-14";
const MORNING = addDays(TODAY, 1);

let h: Harness;
let seed: SeededFamily;

beforeAll(async () => {
  h = await createHarness();
}, 60_000);
afterAll(async () => {
  await h.close();
});

async function family(options: { memberLanguage?: "en" | "zh-TW"; organiserName?: string } = {}) {
  await h.reset();
  seed = await seedFamily(h.db, { now: h.clock.now(), ...options });
  await h.db.insert(invites).values({
    familyId: seed.family.id,
    invitedBy: seed.organiser.id,
    forMemberId: seed.member.id,
    token: `invite-${seed.member.id}`,
    tokenHash: tokenHashOf(`invite-${seed.member.id}`),
    expiresAt: addMinutesOf(h.clock.now(), 60 * 24),
    acceptedAt: h.clock.now(),
    acceptedBy: seed.member.id,
  });
}

function addMinutesOf(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function deliverAll() {
  return h.run({ outbound: (job: OutboundJob) => deliverOutbound(h.deps, job.outboundId) });
}

async function morning(): Promise<string> {
  h.clock.set(zonedInstant(MORNING, "08:00", TZ));
  await deliverArrival(h.deps, seed.member.id, MORNING, false);
  await deliverAll();
  return h.telegram.sentTo(seed.memberLink.externalId).at(-1)?.message.text ?? "";
}

async function answer(text: string): Promise<string> {
  await handleInbound(h.deps, [
    {
      channel: "telegram",
      eventId: `tg:${text}`,
      at: h.clock.now().toISOString(),
      messageId: "901",
      sender: { externalUserId: seed.memberLink.externalId },
      conversation: { externalId: seed.memberLink.externalId, kind: "private" },
      kind: "text",
      text,
    } as InboundEvent,
  ]);
  await deliverAll();
  return h.telegram.sentTo(seed.memberLink.externalId).at(-1)?.message.text ?? "";
}

describe("her child, by name", () => {
  beforeEach(() => family());

  it("is whoever invited her, while they are still in her family", async () => {
    expect((await childOf(h.db, seed.member))?.id).toBe(seed.organiser.id);
    await h.db
      .update(members)
      .set({ leftAt: h.clock.now(), status: "left" } as never)
      .where(eq(members.id, seed.organiser.id));
    expect(await childOf(h.db, seed.member)).toBeNull();
  });

  it("signs Vela's morning for her child and names them in the hint, never as I", async () => {
    const text = await morning();

    expect(text).toContain(t("en", "arrival.hello_signature_named", { child: "Mia" }));
    expect(text).toContain(t("en", "arrival.hint_named", { child: "Mia" }));
    expect(text).not.toMatch(/\bI('ll| will)\b/);
  });

  it("thanks her naming who will hear her", async () => {
    await morning();
    h.clock.set(zonedInstant(MORNING, "08:10", TZ));

    const thanks = await answer("Soup with my neighbour");

    expect(thanks).toContain("Mia");
    expect(thanks).not.toContain("the family");
  });

  it("goes back to the family's wording once her child has left, never naming someone gone", async () => {
    await h.db
      .update(members)
      .set({ leftAt: h.clock.now(), status: "left" } as never)
      .where(eq(members.id, seed.organiser.id));

    const text = await morning();

    expect(text).toContain(t("en", "arrival.hello_signature"));
    expect(text).not.toContain("Mia");
  });

  it("names her child in Chinese with one dash", async () => {
    await family({ memberLanguage: "zh-TW", organiserName: "小美" });

    const text = await morning();

    expect(text).toContain("— Vela（代小美問候）");
    expect(text).toContain("小美最喜歡聽您的聲音");
    const [row] = await h.db
      .select()
      .from(exchanges)
      .where(and(eq(exchanges.recipientId, seed.member.id), eq(exchanges.scheduledFor, MORNING)));
    expect(row?.type).toBe("hello");
  });
});
