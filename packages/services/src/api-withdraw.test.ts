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
import { composeApiAsk } from "./api-asks.ts";
import { loadApiToday } from "./api-today.ts";
import { WithdrawTooLateError, withdrawApiAsk } from "./api-withdraw.ts";
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
