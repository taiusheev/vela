import { ApiMorningPreferences } from "@vela/contracts";
import { addDays, localDateOf } from "@vela/core";
import { exchanges, members, outbound, users } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadApiMorningPreferences, setApiMorningPreferences } from "./api-morning-preferences.ts";
import { deliverArrival } from "./arrivals.ts";
import { deliverOutbound } from "./gateway.ts";
import { morningTimeOn } from "./morning-time.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { type SeededFamily, seedFamily } from "./testing/seed.ts";
import { loadScheduleInput, tickMember } from "./tick.ts";

let h: Harness;
let seed: SeededFamily;
let serial = 0;
const who = { authSubject: "morning|organiser", sessionId: "morning-session" };
beforeAll(async () => {
  h = await createHarness();
}, 60_000);
beforeEach(async () => {
  await h.reset();
  seed = await seedFamily(h.db, { now: h.clock.now() });
  await h.db
    .update(members)
    .set({ lightStartsOn: localDateOf(h.clock.now(), seed.member.tz) })
    .where(eq(members.id, seed.member.id));
  const [user] = await h.db
    .insert(users)
    .values({ authSubject: who.authSubject, displayName: "Mia" })
    .returning();
  await h.db
    .update(members)
    .set({ userId: user?.id ?? null })
    .where(eq(members.id, seed.organiser.id));
});
afterAll(async () => {
  await h.close();
});
async function save(time: string, language = "en", key = `morning-${++serial}`) {
  return setApiMorningPreferences(h.deps, who, key, seed.family.id, seed.member.id, {
    arrival_time: time,
    language,
  });
}
async function her() {
  const [row] = await h.db.select().from(members).where(eq(members.id, seed.member.id));
  if (!row) throw new Error("missing member");
  return row;
}
describe("organiser morning preferences", () => {
  it("keeps today's time across repeated earlier and later edits; tomorrow wakes at the last choice", async () => {
    const today = localDateOf(h.clock.now(), seed.member.tz);
    const first = await save("06:00");
    expect(first.after.wakeMemberIds).toEqual([seed.member.id]);
    expect(ApiMorningPreferences.parse(first.response.body)).toMatchObject({
      today_arrival_time: "08:00",
      arrival_time: "06:00",
      effective_from: addDays(today, 1),
    });
    await save("10:00");
    await save("07:30");
    const row = await her();
    expect(morningTimeOn(row, today)).toBe("08:00");
    expect(morningTimeOn(row, addDays(today, 1))).toBe("07:30");
    const schedule = await loadScheduleInput(h.deps, seed.member.id, h.clock.now());
    expect(schedule?.member).toMatchObject({ arrivalTime: "08:00", nextArrivalTime: "07:30" });
  });
  it("promotes yesterday's edit before recording another tomorrow time", async () => {
    await save("06:00");
    h.clock.advanceMinutes(24 * 60);
    const second = ApiMorningPreferences.parse((await save("09:00")).response.body);
    expect(second.today_arrival_time).toBe("06:00");
    expect((await her()).arrivalTime).toBe("06:00");
  });
  it("replays the original receipt without applying the edit again or waking twice", async () => {
    const key = `replay-${++serial}`;
    const first = await save("07:00", "en", key);
    await save("09:00");
    const replay = await save("07:00", "en", key);
    expect(replay.replayed).toBe(true);
    expect(replay.response).toEqual(first.response);
    expect(replay.after.wakeMemberIds).toEqual([]);
    expect((await her()).pendingArrivalTime).toBe("09:00");
  });
  it("rejects strangers, ordinary members, other-family targets and inactive parents", async () => {
    expect(
      await loadApiMorningPreferences(
        h.db,
        { ...who, authSubject: "stranger" },
        seed.family.id,
        seed.member.id,
        h.clock.now(),
      ),
    ).toBeNull();
    const other = await seedFamily(h.db, {
      now: h.clock.now(),
      organiserExternalId: "5001",
      memberExternalId: "6001",
    });
    await expect(
      setApiMorningPreferences(h.deps, who, `other-${++serial}`, seed.family.id, other.member.id, {
        arrival_time: "07:00",
        language: "en",
      }),
    ).rejects.toThrow();
    await h.db.update(members).set({ role: "member" }).where(eq(members.id, seed.organiser.id));
    await expect(save("07:00")).rejects.toThrow();
    await h.db.update(members).set({ role: "organiser" }).where(eq(members.id, seed.organiser.id));
    await h.db.update(members).set({ status: "deceased" }).where(eq(members.id, seed.member.id));
    await expect(save("07:00")).rejects.toThrow();
  });
  it("validates time and complete-copy languages before writing", async () => {
    for (const time of ["24:00", "7:00", "08:60", "tomorrow"])
      await expect(save(time)).rejects.toMatchObject({ code: "invalid" });
    await expect(save("07:00", "ja")).rejects.toMatchObject({ code: "invalid" });
    expect((await her()).pendingArrivalDate).toBeNull();
  });
  it("updates language without postponing an existing time edit", async () => {
    await save("07:00");
    const pending = (await her()).pendingArrivalDate;
    const result = await save("07:00", "zh-TW");
    expect(result.after.wakeMemberIds).toEqual([]);
    expect((await her()).pendingArrivalDate).toBe(pending);
    expect((await her()).language).toBe("zh-TW");
  });
  it("does not send today's morning again after a later edit", async () => {
    await tickMember(h.deps, seed.member.id);
    await h.runDue({ outbound: (job) => deliverOutbound(h.deps, job.outboundId) });
    const today = localDateOf(h.clock.now(), seed.member.tz);
    await save("10:00");
    h.clock.advanceMinutes(120);
    await tickMember(h.deps, seed.member.id);
    await h.runDue({ outbound: (job) => deliverOutbound(h.deps, job.outboundId) });
    const sent = await h.db.select().from(outbound).where(eq(outbound.kind, "arrival"));
    expect(sent).toHaveLength(1);
    const [day] = await h.db.select().from(exchanges).where(eq(exchanges.scheduledFor, today));
    expect(day?.deliveredAt).not.toBeNull();
  });
  it("holds a stale early arrival for tomorrow's new time, then sends once", async () => {
    await save("10:00");
    h.clock.advanceMinutes(24 * 60);
    const tomorrow = localDateOf(h.clock.now(), seed.member.tz);
    await deliverArrival(h.deps, seed.member.id, tomorrow, false);
    expect(await h.db.select().from(outbound).where(eq(outbound.kind, "arrival"))).toHaveLength(0);
    h.clock.advanceMinutes(120);
    await tickMember(h.deps, seed.member.id);
    await h.runDue({ outbound: (job) => deliverOutbound(h.deps, job.outboundId) });
    expect(await h.db.select().from(outbound).where(eq(outbound.kind, "arrival"))).toHaveLength(1);
  });
});
