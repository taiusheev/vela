/**
 * Memories the family keeps (ADR-50): an organiser keeps any ordinary answer of hers with "Keep";
 * Vela suggests answers worth keeping to the organisers; she is told once in her chat, never
 * asked; "memories off" in her chat removes what was kept and stops it, "memories on" lets the
 * family keep again. Synthetic family only.
 */
import { fakeRecord } from "@vela/ai";
import type { InboundEvent } from "@vela/contracts";
import { t } from "@vela/copy";
import { encodeButton } from "@vela/core";
import {
  answers,
  bookEntries,
  type Exchange,
  keepSuggestions,
  members,
  outbound,
  users,
} from "@vela/db";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "./api-access.ts";
import { loadApiBook } from "./book.ts";
import type { OutboundJob } from "./deps.ts";
import { VelaError } from "./errors.ts";
import { deliverOutbound } from "./gateway.ts";
import { handleInbound } from "./inbound/router.ts";
import { dismissApiSuggestion, keepApiAnswer, suggestKeeping } from "./memories.ts";
import { handleParentCommand } from "./parent-commands.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import {
  type SeededFamily,
  seedExchange,
  seedFamily,
  seedGroupMember,
  seedLinkedGroup,
} from "./testing/seed.ts";

let h: Harness;
let seed: SeededFamily;
const mia: SessionIdentity = { authSubject: "auth|Mia", sessionId: "session-mia" };
const sam: SessionIdentity = { authSubject: "auth|Sam", sessionId: "session-sam" };
const WORDS = "We took the night train to the sea. Nobody minded the wind.";
let day = 0;
let events = 0;

beforeAll(async () => {
  h = await createHarness({ config: { book: true, memoryDiscovery: true } });
}, 60_000);
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await h.reset();
  h.config.book = true;
  h.config.memoryDiscovery = true;
  day = 0;
  seed = await seedFamily(h.db, { now: h.clock.now() });
  await seedLinkedGroup(h.db, seed, { now: h.clock.now() });
  await account(mia, "Mia", seed.organiser.id);
  const brother = await seedGroupMember(h.db, seed, {
    now: h.clock.now(),
    name: "Sam",
    externalId: "3001",
  });
  await account(sam, "Sam", brother.member.id);
});

async function account(identity: SessionIdentity, name: string, memberId: string) {
  const [user] = await h.db
    .insert(users)
    .values({ authSubject: identity.authSubject, displayName: name })
    .returning();
  if (user === undefined) throw new Error(`expected an account for ${name}`);
  await h.db.update(members).set({ userId: user.id }).where(eq(members.id, memberId));
}

/** One answered morning: her words to an ordinary ask. */
async function answered(text = WORDS): Promise<{ exchange: Exchange; answerId: string }> {
  day += 1;
  const exchange = await seedExchange(h.db, seed, {
    date: `2026-09-${String(10 + day).padStart(2, "0")}`,
  });
  const [row] = await h.db
    .insert(answers)
    .values({
      exchangeId: exchange.id,
      memberId: seed.member.id,
      kind: "text",
      channel: "telegram",
      payload: { text },
      receivedAt: h.clock.now(),
    })
    .returning();
  if (row === undefined) throw new Error("Missing synthetic answer");
  return { exchange, answerId: row.id };
}

async function her() {
  const [row] = await h.db.select().from(members).where(eq(members.id, seed.member.id));
  if (row === undefined) throw new Error("Missing her");
  return row;
}

function said(text: string): InboundEvent {
  events += 1;
  return {
    channel: "telegram",
    eventId: `tg:mem:${events}`,
    at: h.clock.now().toISOString(),
    kind: "text",
    text,
    sender: { externalUserId: seed.memberLink.externalId },
    conversation: { externalId: seed.memberLink.externalId, kind: "private" },
    messageId: String(700 + events),
  };
}

async function command(words: string, which: "memories_off" | "memories_on") {
  await handleParentCommand(h.deps, await her(), which, said(words));
}

const told = () =>
  h.db
    .select()
    .from(outbound)
    .where(eq(outbound.memberId, seed.member.id))
    .then((rows) => rows.filter((row) => row.idempotencyKey.includes("memory_told")));

const liveEntries = () => h.db.select().from(bookEntries).where(isNull(bookEntries.removedAt));

const screen = {
  understanding: {
    ok: true as const,
    value: {
      summary: "",
      moodWords: [],
      mentions: { people: [], places: [], plans: [], health: [], dates: [] },
      away: null,
      dated: [],
      language: "en",
    },
    record: fakeRecord("understand"),
  },
  flag: {
    ok: true as const,
    value: { flag: false, category: null, severity: null, evidenceQuote: null },
    record: fakeRecord("flag"),
  },
};

async function suggest(text = WORDS) {
  const { exchange, answerId } = await answered(text);
  const [answer] = await h.db.select().from(answers).where(eq(answers.id, answerId));
  if (answer === undefined) throw new Error("Missing answer");
  const made = await suggestKeeping(h.deps, { answer, member: await her(), exchange }, screen);
  return { exchange, made };
}

describe("an organiser keeps one of her answers", () => {
  it("keeps it in the family book, named for who kept it, with no yes from her", async () => {
    const { exchange } = await answered();
    const kept = await keepApiAnswer(h.deps, mia, "keep-1", exchange.id);
    expect(kept.response.body).toEqual({ exchange_id: exchange.id, kept: true });
    const [entry] = await liveEntries();
    expect(entry).toMatchObject({ exchangeId: exchange.id, keptBy: seed.organiser.id });
    const book = await loadApiBook(h.db, mia, seed.family.id, h.clock.now());
    expect(book?.entries.map((item) => [item.exchange_id, item.kept_by])).toEqual([
      [exchange.id, "Mia"],
    ]);
  });

  it("tells her once in her chat, with how to stop it", async () => {
    const first = await answered();
    const second = await answered("Grandpa sang on the boat.");
    const kept = await keepApiAnswer(h.deps, mia, "keep-1", first.exchange.id);
    await keepApiAnswer(h.deps, mia, "keep-2", second.exchange.id);
    expect(kept.after.outboundIds).toHaveLength(1);
    const notes = await told();
    expect(notes).toHaveLength(1);
    await deliverOutbound(h.deps, kept.after.outboundIds[0] ?? "");
    expect(h.telegram.sentTo(seed.memberLink.externalId).map((m) => m.message.text)).toContain(
      t("en", "memory.told", { organiser: "Mia" }),
    );
  });

  it("is only for organisers of her family", async () => {
    const { exchange } = await answered();
    await expect(keepApiAnswer(h.deps, sam, "keep-sam", exchange.id)).rejects.toBeInstanceOf(
      VelaError,
    );
    expect(await liveEntries()).toEqual([]);
  });

  it("refuses an answer with health or other sensitive words", async () => {
    const { exchange } = await answered("The garden is lovely but my knee hurts.");
    const kept = await keepApiAnswer(h.deps, mia, "keep-1", exchange.id);
    expect(kept.response.body).toMatchObject({ kept: false, reason: "sensitive" });
    expect(await liveEntries()).toEqual([]);
    expect(await told()).toEqual([]);
  });

  it("does nothing with the book switched off", async () => {
    h.config.book = false;
    const { exchange } = await answered();
    await expect(keepApiAnswer(h.deps, mia, "keep-1", exchange.id)).rejects.toBeInstanceOf(
      VelaError,
    );
  });
});

describe("her “memories off” and “memories on”", () => {
  it("removes every kept answer of hers, and nothing more can be kept", async () => {
    const { exchange } = await answered();
    await keepApiAnswer(h.deps, mia, "keep-1", exchange.id);
    await suggest("Grandpa sang on the boat.");
    await command("memories off", "memories_off");
    await h.run({ outbound: (job: OutboundJob) => deliverOutbound(h.deps, job.outboundId) });
    expect(await liveEntries()).toEqual([]);
    expect(await h.db.select().from(keepSuggestions)).toEqual([]);
    expect((await her()).memoriesOffAt).not.toBeNull();
    expect(h.telegram.sentTo(seed.memberLink.externalId).map((m) => m.message.text)).toContain(
      t("en", "memory.off_done"),
    );
    const another = await answered("Grandpa sang on the boat.");
    const refused = await keepApiAnswer(h.deps, mia, "keep-2", another.exchange.id);
    expect(refused.response.body).toMatchObject({ kept: false, reason: "memories_off" });
  });

  it("“memories on” lets the family keep again, but never brings back what she removed", async () => {
    const { exchange } = await answered();
    await keepApiAnswer(h.deps, mia, "keep-1", exchange.id);
    await command("memories off", "memories_off");
    await command("memories on", "memories_on");
    expect((await her()).memoriesOffAt).toBeNull();
    const again = await keepApiAnswer(h.deps, mia, "keep-2", exchange.id);
    expect(again.response.body).toMatchObject({ kept: false, reason: "not_kept" });
    const fresh = await answered("Grandpa sang on the boat.");
    const kept = await keepApiAnswer(h.deps, mia, "keep-3", fresh.exchange.id);
    expect(kept.response.body).toMatchObject({ kept: true });
  });

  it("reaches the router in her own words", async () => {
    await handleInbound(h.deps, [said("memories off")]);
    expect((await her()).memoriesOffAt).not.toBeNull();
    await handleInbound(h.deps, [said("開啟回憶")]);
    expect((await her()).memoriesOffAt).toBeNull();
  });
});

describe("suggestions to keep", () => {
  it("suggests an ordinary answer to organisers only, in her exact words", async () => {
    const { exchange, made } = await suggest();
    expect(made).toBe(true);
    const forMia = await loadApiBook(h.db, mia, seed.family.id, h.clock.now());
    expect(forMia?.suggestions).toEqual([
      expect.objectContaining({
        exchange_id: exchange.id,
        quote: "We took the night train to the sea.",
      }),
    ]);
    const forSam = await loadApiBook(h.db, sam, seed.family.id, h.clock.now());
    expect(forSam?.suggestions).toEqual([]);
  });

  it("never sends sensitive words to the model, and nothing while memories are off", async () => {
    const picks = () => h.ai.calls.filter((call) => call.call === "memory_pick").length;
    await suggest("We went to the doctor and then the sea.");
    expect(picks()).toBe(0);
    await h.db
      .update(members)
      .set({ memoriesOffAt: h.clock.now() })
      .where(eq(members.id, seed.member.id));
    await suggest();
    expect(picks()).toBe(0);
    expect(await h.db.select().from(keepSuggestions)).toEqual([]);
  });

  it("disappears once kept, or on “Not this one”", async () => {
    const first = await suggest();
    const second = await suggest("Grandpa sang on the boat by the lighthouse.");
    await keepApiAnswer(h.deps, mia, "keep-1", first.exchange.id);
    await dismissApiSuggestion(h.deps, mia, "dismiss-1", second.exchange.id);
    const book = await loadApiBook(h.db, mia, seed.family.id, h.clock.now());
    expect(book?.suggestions).toEqual([]);
    const [dismissed] = await h.db
      .select()
      .from(keepSuggestions)
      .where(and(eq(keepSuggestions.exchangeId, second.exchange.id)));
    expect(dismissed?.dismissedBy).toBe(seed.organiser.id);
  });
});

describe("the retired memory buttons in her chat", () => {
  it("close and tell her there is nothing to do", async () => {
    events += 1;
    await handleInbound(h.deps, [
      {
        channel: "telegram",
        eventId: `tg:mem:${events}`,
        at: h.clock.now().toISOString(),
        kind: "button",
        sender: { externalUserId: seed.memberLink.externalId },
        conversation: { externalId: seed.memberLink.externalId, kind: "private" },
        messageId: "77",
        buttonData: encodeButton({
          type: "memory_permission",
          memberId: seed.member.id,
          accept: true,
        }),
        callbackId: `cb:${events}`,
      },
    ]);
    expect(h.telegram.sentTo(seed.memberLink.externalId).map((m) => m.message.text)).toContain(
      t("en", "memory.gone"),
    );
  });
});
