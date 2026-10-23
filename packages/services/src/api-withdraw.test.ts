/**
 * Withdrawing an ask (spec §19): the asker takes it back while her morning is not prepared, and
 * Today offers it only to them; once her morning holds it, it is too late.
 */
import { ApiComposedAsk } from "@vela/contracts";
import { addDays, localDateOf } from "@vela/core";
import { exchanges, members, users } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "./api-access.ts";
import { AskDayTakenError, composeApiAsk } from "./api-asks.ts";
import { loadApiPlannedQuestions } from "./api-exchanges.ts";
import { loadApiToday } from "./api-today.ts";
import { editApiAsk, WithdrawTooLateError, withdrawApiAsk } from "./api-withdraw.ts";
import { prepareDay } from "./arrivals.ts";
import { VelaError } from "./errors.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { type SeededFamily, seedFamily, seedGroupMember } from "./testing/seed.ts";

let h: Harness;
let seed: SeededFamily;
const mia: SessionIdentity = { authSubject: "auth|Mia", sessionId: "session-mia" };
const sam: SessionIdentity = { authSubject: "auth|Sam", sessionId: "session-sam" };
let keys = 0;

beforeAll(async () => {
  h = await createHarness();
}, 60_000);
beforeEach(async () => {
  await h.reset();
  seed = await seedFamily(h.db, { now: h.clock.now() });
  await account(mia, "Mia", seed.organiser.id);
  const brother = await seedGroupMember(h.db, seed, {
    now: h.clock.now(),
    name: "Sam",
    externalId: "3001",
  });
  await account(sam, "Sam", brother.member.id);
});
afterAll(async () => {
  await h.close();
});

async function account(identity: SessionIdentity, name: string, memberId: string) {
  const [user] = await h.db
    .insert(users)
    .values({ authSubject: identity.authSubject, displayName: name })
    .returning();
  await h.db
    .update(members)
    .set({ userId: user?.id ?? null })
    .where(eq(members.id, memberId));
}

async function asked() {
  keys += 1;
  const composed = await composeApiAsk(h.deps, mia, `ask-${keys}`, seed.family.id, {
    recipient_id: seed.member.id,
    type: "question",
    text: "What did you cook today?",
    when: "tomorrow",
  });
  return ApiComposedAsk.parse(composed.response.body);
}

async function withdraw(who: SessionIdentity, id: string) {
  keys += 1;
  return withdrawApiAsk(h.deps, who, `withdraw-${keys}`, id);
}

describe("withdrawing an ask", () => {
  it("is offered to the asker on Today, and takes the ask back", async () => {
    const ask = await asked();
    const today = await loadApiToday(h.db, mia, seed.family.id, h.clock.now());
    expect(today?.tomorrow[0]?.ask).toMatchObject({ id: ask.id, withdrawable: true });
    const forSam = await loadApiToday(h.db, sam, seed.family.id, h.clock.now());
    expect(forSam?.tomorrow[0]?.ask).toMatchObject({ id: ask.id, withdrawable: false });

    const result = await withdraw(mia, ask.id);
    const again = await withdraw(mia, ask.id);

    expect(result.response.body).toEqual({ id: ask.id, state: "withdrawn" });
    expect(again.response.body).toEqual({ id: ask.id, state: "withdrawn" });
    const [row] = await h.db.select().from(exchanges).where(eq(exchanges.id, ask.id));
    expect(row?.state).toBe("withdrawn");
  });

  it("is the asker's alone", async () => {
    const ask = await asked();
    await expect(withdraw(sam, ask.id)).rejects.toBeInstanceOf(VelaError);
  });

  it("is too late once her morning is prepared with it", async () => {
    const ask = await asked();
    const tomorrow = addDays(localDateOf(h.clock.now(), seed.member.tz), 1);
    await prepareDay(h.deps, seed.member.id, tomorrow);

    await expect(withdraw(mia, ask.id)).rejects.toBeInstanceOf(WithdrawTooLateError);
    const [row] = await h.db.select().from(exchanges).where(eq(exchanges.id, ask.id));
    expect(row?.state).toBe("scheduled");
  });
});

describe("planned questions and editing", () => {
  it("lists every waiting morning and only the author's edit control", async () => {
    const ask = await asked();
    const date = addDays(localDateOf(h.clock.now(), seed.member.tz), 6);
    await composeApiAsk(h.deps, mia, "second-day", seed.family.id, {
      recipient_id: seed.member.id,
      type: "question",
      text: "Did you plant the tomatoes?",
      when: "date",
      date,
    });
    const mine = await loadApiPlannedQuestions(h.db, mia, seed.family.id);
    expect(mine?.questions).toHaveLength(2);
    expect(mine?.questions[0]).toMatchObject({ id: ask.id, editable: true });
    expect(mine?.questions[1]?.date).toBe(date);
    expect(
      (await loadApiPlannedQuestions(h.db, sam, seed.family.id))?.questions.every(
        (item) => !item.editable,
      ),
    ).toBe(true);
    expect(
      await loadApiPlannedQuestions(
        h.db,
        { authSubject: "outsider", sessionId: "other" },
        seed.family.id,
      ),
    ).toBeNull();
  });
  it("changes wording and date together under the same delivery identity and replays safely", async () => {
    const ask = await asked();
    const input = {
      text: "Mom, how did the tomatoes turn out?",
      date: addDays(ask.scheduled_for ?? "", 3),
    };
    const changed = await editApiAsk(h.deps, mia, "edit-once", ask.id, input);
    const retry = await editApiAsk(h.deps, mia, "edit-once", ask.id, input);
    expect(changed.replayed).toBe(false);
    expect(retry.replayed).toBe(true);
    const [row] = await h.db.select().from(exchanges).where(eq(exchanges.id, ask.id));
    expect(row).toMatchObject({
      id: ask.id,
      text: input.text,
      scheduledFor: input.date,
      state: "composed",
      askerId: seed.organiser.id,
    });
  });
  it("keeps the original when the new morning is occupied", async () => {
    const ask = await asked();
    const date = addDays(ask.scheduled_for ?? "", 1);
    await composeApiAsk(h.deps, sam, "sam-day", seed.family.id, {
      recipient_id: seed.member.id,
      type: "question",
      text: "What is growing?",
      when: "date",
      date,
    });
    await expect(
      editApiAsk(h.deps, mia, "edit-conflict", ask.id, { text: "Changed", date }),
    ).rejects.toBeInstanceOf(AskDayTakenError);
    const [row] = await h.db.select().from(exchanges).where(eq(exchanges.id, ask.id));
    expect(row).toMatchObject({
      text: ask.ask,
      scheduledFor: ask.scheduled_for,
      state: "composed",
    });
  });
  it("keeps consent and paused-recipient boundaries when editing", async () => {
    const ask = await asked();
    await h.db
      .update(members)
      .set({ status: "invited", lightOn: false, lightConsentedAt: null })
      .where(eq(members.id, seed.member.id));
    await expect(
      editApiAsk(h.deps, mia, "invited-edit", ask.id, { text: "Changed", date: ask.scheduled_for }),
    ).rejects.toBeInstanceOf(VelaError);
    await h.db
      .update(members)
      .set({ status: "paused", lightOn: true, lightConsentedAt: h.clock.now() })
      .where(eq(members.id, seed.member.id));
    await expect(
      editApiAsk(h.deps, mia, "paused-edit", ask.id, { text: "Changed", date: ask.scheduled_for }),
    ).rejects.toBeInstanceOf(VelaError);
    const [row] = await h.db.select().from(exchanges).where(eq(exchanges.id, ask.id));
    expect(row?.text).toBe(ask.ask);
  });

  it("refuses another author's edit, invalid dates, withdrawn and prepared questions", async () => {
    const ask = await asked();
    const input = { text: "Changed", date: ask.scheduled_for };
    await expect(editApiAsk(h.deps, sam, "not-mine", ask.id, input)).rejects.toBeInstanceOf(
      VelaError,
    );
    await expect(
      editApiAsk(h.deps, mia, "past", ask.id, { ...input, date: "2000-01-01" }),
    ).rejects.toBeInstanceOf(VelaError);
    await prepareDay(h.deps, seed.member.id, ask.scheduled_for ?? "");
    await expect(editApiAsk(h.deps, mia, "too-late", ask.id, input)).rejects.toBeInstanceOf(
      WithdrawTooLateError,
    );
  });
});
