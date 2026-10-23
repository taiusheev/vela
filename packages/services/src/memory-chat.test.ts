import type { InboundEvent } from "@vela/contracts";
import { t } from "@vela/copy";
import { decodeButton, encodeButton } from "@vela/core";
import {
  answers,
  consents,
  invites,
  members,
  memoryCandidates,
  memoryKeeps,
  memoryShares,
  users,
} from "@vela/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { OutboundJob } from "./deps.ts";
import { deliverOutbound } from "./gateway.ts";
import {
  askMemoryQuestion,
  handleMemoryOfferButton,
  handleMemoryPermissionButton,
  offerMemory,
} from "./memory-chat.ts";
import { loadSharedKeptMemories } from "./memory-keeps.ts";
import { handleParentCommand } from "./parent-commands.ts";
import { proposeMemoryCandidate } from "./rich-memories.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { type SeededFamily, seedExchange, seedFamily } from "./testing/seed.ts";

let h: Harness;
let seed: SeededFamily;
let sequence = 0;
const HER = "2001";
const ORGANISER_ACCOUNT = { authSubject: "synthetic|chat-organiser", sessionId: "organiser" };
const WORDS = "We took the night train to the sea. Nobody minded the wind.";

beforeAll(async () => {
  h = await createHarness({ config: { richMemories: true, memoryDiscovery: true } });
}, 60_000);
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await h.reset();
  h.config.richMemories = true;
  h.config.memoryDiscovery = true;
  seed = await seedFamily(h.db, { now: h.clock.now() });
  // The organiser invited her and has the app, so she can share with them by name.
  await h.db.insert(invites).values({
    familyId: seed.family.id,
    invitedBy: seed.organiser.id,
    forMemberId: seed.member.id,
    token: "synthetic-chat-invite",
    channel: "link",
    createdAt: h.clock.now(),
    expiresAt: new Date(h.clock.now().getTime() + 86_400_000),
    acceptedAt: h.clock.now(),
    acceptedBy: seed.member.id,
  });
  const [user] = await h.db
    .insert(users)
    .values({ authSubject: ORGANISER_ACCOUNT.authSubject, displayName: "Mia" })
    .returning();
  if (!user) throw new Error("Missing synthetic account");
  await h.db.update(members).set({ userId: user.id }).where(eq(members.id, seed.organiser.id));
  seed = { ...seed, organiser: { ...seed.organiser, userId: user.id } };
});

const handlers = () => ({
  outbound: (job: OutboundJob) => deliverOutbound(h.deps, job.outboundId),
});
function tap(buttonData: string, user = HER): InboundEvent {
  sequence += 1;
  return {
    channel: "telegram",
    eventId: `tg:chat:${sequence}`,
    at: h.clock.now().toISOString(),
    kind: "button",
    sender: { externalUserId: user },
    conversation: { externalId: user, kind: "private" },
    messageId: "7",
    buttonData,
    callbackId: `cb:${sequence}`,
  };
}
async function her() {
  const [row] = await h.db.select().from(members).where(eq(members.id, seed.member.id));
  if (!row) throw new Error("Missing her");
  return row;
}
async function yes() {
  await handleMemoryPermissionButton(
    h.deps,
    tap(encodeButton({ type: "memory_permission", memberId: seed.member.id, accept: true })),
    { type: "memory_permission", memberId: seed.member.id, accept: true },
  );
}
async function candidate() {
  h.clock.advance(1000);
  const exchange = await seedExchange(h.db, seed, { date: "2026-09-14" });
  const [answer] = await h.db
    .insert(answers)
    .values({
      exchangeId: exchange.id,
      memberId: seed.member.id,
      kind: "text",
      channel: "telegram",
      payload: { text: WORDS },
      receivedAt: h.clock.now(),
    })
    .returning();
  if (!answer) throw new Error("Missing answer");
  const id = await proposeMemoryCandidate(
    h.deps,
    { source_answer_id: answer.id, kind: "story", start: 0, end: 35 },
    { answerId: answer.id, ordinaryText: WORDS },
  );
  if (!id) throw new Error("Missing candidate");
  return id;
}
const offerTap = (candidateId: string, choice: "keep" | "share" | "leave", user = HER) =>
  handleMemoryOfferButton(
    h.deps,
    tap(encodeButton({ type: "memory_offer", candidateId, choice }), user),
    {
      type: "memory_offer",
      candidateId,
      choice,
    },
  );

describe("the memory question in her chat", () => {
  it("is asked once, with the approved words and her two buttons", async () => {
    await askMemoryQuestion(h.deps, await her(), seed.family);
    await askMemoryQuestion(h.deps, await her(), seed.family);
    await h.run(handlers());
    const sent = h.telegram.sentTo(HER);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.message.text).toBe(t("en", "memory.question"));
    expect(
      sent[0]?.message.buttons?.flat().map((button) => [decodeButton(button.id), button.label]),
    ).toEqual([
      [{ type: "memory_permission", memberId: seed.member.id, accept: true }, "Yes, suggest"],
      [{ type: "memory_permission", memberId: seed.member.id, accept: false }, "Not now"],
    ]);
  });

  it("records her own yes once, with proof of the words she saw, and thanks her", async () => {
    await yes();
    await yes();
    await h.run(handlers());
    const rows = await h.db
      .select()
      .from(consents)
      .where(and(eq(consents.memberId, seed.member.id), eq(consents.kind, "rich_memories")));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ answer: "yes", textVersion: "consent.rich_memories@2" });
    expect(rows[0]?.evidence).toMatchObject({ chat_id: HER, message_id: "7" });
    expect(h.telegram.sentTo(HER).map((entry) => entry.message.text)).toContain(
      t("en", "memory.allowed"),
    );
  });

  it("ignores a tap from anyone else, an organiser included", async () => {
    await handleMemoryPermissionButton(
      h.deps,
      tap(
        encodeButton({ type: "memory_permission", memberId: seed.member.id, accept: true }),
        seed.organiserLink.externalId,
      ),
      { type: "memory_permission", memberId: seed.member.id, accept: true },
    );
    expect(await h.db.select().from(consents).where(eq(consents.kind, "rich_memories"))).toEqual(
      [],
    );
  });
});

describe("a suggestion offered in her chat", () => {
  it("names the organiser on the share button and carries both explanations", async () => {
    await yes();
    const id = await candidate();
    await offerMemory(h.deps, await her(), id, WORDS.slice(0, 35));
    await h.run(handlers());
    const offer = h.telegram
      .sentTo(HER)
      .find((entry) => entry.message.text.startsWith(`“${WORDS.slice(0, 35)}”`));
    expect(offer?.message.text).toBe(
      t("en", "memory.offer_share", { quote: WORDS.slice(0, 35), organiser: "Mia" }),
    );
    expect(offer?.message.buttons?.flat().map((button) => button.label)).toEqual([
      "Keep",
      "Share with Mia",
      "Leave out",
    ]);
  });

  it("keeps her words privately on Keep", async () => {
    await yes();
    const id = await candidate();
    await offerTap(id, "keep");
    const [kept] = await h.db.select().from(memoryKeeps);
    expect(kept).toMatchObject({ memberId: seed.member.id, quote: WORDS.slice(0, 35) });
    expect(await h.db.select().from(memoryShares)).toEqual([]);
  });

  it("keeps and shares with the organiser, who then reads it in the app", async () => {
    await yes();
    const id = await candidate();
    await offerTap(id, "share");
    const [share] = await h.db.select().from(memoryShares);
    expect(share).toMatchObject({ recipientMemberId: seed.organiser.id });
    const page = await loadSharedKeptMemories(h.deps, ORGANISER_ACCOUNT, seed.family.id);
    expect(page?.items.map((item) => item.quote)).toEqual([WORDS.slice(0, 35)]);
  });

  it("leaves it out on Leave out, and nothing is kept", async () => {
    await yes();
    const id = await candidate();
    await offerTap(id, "leave");
    const [row] = await h.db.select().from(memoryCandidates).where(eq(memoryCandidates.id, id));
    expect(row?.dismissedAt).not.toBeNull();
    expect(await h.db.select().from(memoryKeeps)).toEqual([]);
  });

  it("refuses a keep tapped by someone else", async () => {
    await yes();
    const id = await candidate();
    await offerTap(id, "share", seed.organiserLink.externalId);
    expect(await h.db.select().from(memoryKeeps)).toEqual([]);
  });
});

describe("“memories off” in her chat", () => {
  it("withdraws her yes, clears her kept words, and stops shared reading", async () => {
    await yes();
    const id = await candidate();
    await offerTap(id, "share");
    sequence += 1;
    await handleParentCommand(h.deps, await her(), "memories_off", {
      channel: "telegram",
      eventId: `tg:chat:${sequence}`,
      at: h.clock.now().toISOString(),
      kind: "text",
      text: "memories off",
      sender: { externalUserId: HER },
      conversation: { externalId: HER, kind: "private" },
      messageId: "9",
    });
    await h.run(handlers());
    expect(await h.db.select().from(memoryKeeps)).toEqual([]);
    expect(await h.db.select().from(memoryCandidates)).toEqual([]);
    const [consent] = await h.db
      .select()
      .from(consents)
      .where(and(eq(consents.memberId, seed.member.id), eq(consents.kind, "rich_memories")));
    expect(consent?.withdrawnAt).not.toBeNull();
    const page = await loadSharedKeptMemories(h.deps, ORGANISER_ACCOUNT, seed.family.id);
    expect(page?.items).toEqual([]);
    expect(h.telegram.sentTo(HER).map((entry) => entry.message.text)).toContain(
      t("en", "memory.off_done"),
    );
  });

  it("cannot be switched back on by tapping the old question", async () => {
    await yes();
    sequence += 1;
    await handleParentCommand(h.deps, await her(), "memories_off", {
      channel: "telegram",
      eventId: `tg:chat:${sequence}`,
      at: h.clock.now().toISOString(),
      kind: "text",
      text: "memories off",
      sender: { externalUserId: HER },
      conversation: { externalId: HER, kind: "private" },
      messageId: "9",
    });
    await yes();
    const rows = await h.db
      .select()
      .from(consents)
      .where(and(eq(consents.memberId, seed.member.id), eq(consents.kind, "rich_memories")));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.withdrawnAt).not.toBeNull();
  });
});
