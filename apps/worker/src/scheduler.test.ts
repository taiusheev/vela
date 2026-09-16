import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { MemberScheduler } from "./scheduler.ts";
import { argsOf, createFakeRuntime, type FakeRuntime, testEnv } from "./testing/fakes.ts";

function schedulerFor(memberId: string): DurableObjectStub<MemberScheduler> {
  const namespace = testEnv.MEMBER_SCHEDULER;
  return namespace.get(namespace.idFromName(memberId));
}

/**
 * Fires the alarm inside the object, against fake services, as workerd does: while the handler
 * runs, the storage no longer reports the alarm that fired, only one set since.
 */
async function runAlarm(
  stub: DurableObjectStub<MemberScheduler>,
  fake: FakeRuntime,
): Promise<number | null> {
  return runInDurableObject(stub, async (instance, state) => {
    instance.runtime = fake.runtime;
    await state.storage.deleteAlarm();
    await instance.alarm();
    return state.storage.getAlarm();
  });
}

async function alarmOf(stub: DurableObjectStub<MemberScheduler>): Promise<number | null> {
  return runInDurableObject(stub, (_instance, state) => state.storage.getAlarm());
}

describe("the member scheduler", () => {
  it("stores the member and sets the alarm for the wake it was given", async () => {
    const memberId = "member-wake";
    const at = new Date("2031-01-01T00:30:00.000Z");
    const stub = schedulerFor(memberId);

    await stub.wakeAt(memberId, at);

    const stored = await runInDurableObject(stub, async (_instance, state) => ({
      alarm: await state.storage.getAlarm(),
      memberId: await state.storage.get<string>("memberId"),
    }));
    expect(stored.alarm).toBe(at.getTime());
    expect(stored.memberId).toBe(memberId);
  });

  it("ticks the member and re-arms at the time the tick returned", async () => {
    const memberId = "member-tick";
    const next = new Date("2031-01-02T00:00:00.000Z");
    const fake = createFakeRuntime({ services: { tickMember: async () => next } });
    const stub = schedulerFor(memberId);
    await stub.wakeAt(memberId, new Date("2031-01-01T00:00:00.000Z"));

    const alarm = await runAlarm(stub, fake);

    expect(argsOf(fake.calls, "tickMember")).toEqual([[memberId]]);
    expect(alarm).toBe(next.getTime());
    expect(fake.closed()).toBe(1);
  });

  it("clears the alarm when the tick says there is nothing more to wake for", async () => {
    const memberId = "member-done";
    const fake = createFakeRuntime({ services: { tickMember: async () => null } });
    const stub = schedulerFor(memberId);
    await stub.wakeAt(memberId, new Date("2031-01-01T00:00:00.000Z"));

    expect(await runAlarm(stub, fake)).toBeNull();
  });

  it("keeps the light on when a tick throws: it logs and tries again shortly", async () => {
    const memberId = "member-broken";
    const fake = createFakeRuntime({
      services: {
        tickMember: async () => {
          throw new Error("the database is away");
        },
      },
    });
    const stub = schedulerFor(memberId);
    await stub.wakeAt(memberId, new Date("2031-01-01T00:00:00.000Z"));

    const alarm = await runAlarm(stub, fake);

    expect(alarm).not.toBeNull();
    expect(alarm ?? 0).toBeGreaterThan(Date.now());
    expect(fake.closed()).toBe(1);
  });

  // The port a tick receives writes a wake for this member onto this object rather than calling
  // itself over RPC, which would wait on the lock the alarm handler holds. The routing itself is
  // not observable here — both paths reach the same object's storage, and a self-RPC does not
  // deadlock under the test pool — so what this pins is the wake landing, on time, before the tick
  // returns: a port that dropped it, deferred it, or set the wrong instant fails.
  it("has the wake a tick asked for on this object before the tick returns", async () => {
    const memberId = "member-self";
    const inner = new Date("2031-01-03T00:00:00.000Z");
    const stub = schedulerFor(memberId);
    await stub.wakeAt(memberId, new Date("2031-01-01T00:00:00.000Z"));
    /** The object's own alarm, read while its alarm handler is still running. */
    const duringTick: (number | null)[] = [];

    const after = await runInDurableObject(stub, async (instance, state) => {
      const fake = createFakeRuntime({
        services: {
          tickMember: async (deps, id) => {
            await deps.scheduler.wakeAt(id, inner);
            // The wake has to be on this object's storage before the tick returns: an RPC to
            // itself would be waiting on the lock this handler holds instead.
            duringTick.push(await state.storage.getAlarm());
            return null;
          },
        },
      });
      instance.runtime = fake.runtime;
      await state.storage.deleteAlarm();
      await instance.alarm();
      return state.storage.getAlarm();
    });

    expect(duringTick).toEqual([inner.getTime()]);
    // Then the tick returned null, so the alarm it had just set was cleared after it.
    expect(after).toBeNull();
  });

  it("never moves a wake later, and moves one sooner", async () => {
    const memberId = "member-sooner";
    const sooner = new Date("2031-01-01T08:00:00.000Z");
    const stub = schedulerFor(memberId);
    await stub.wakeAt(memberId, new Date("2031-01-02T00:00:00.000Z"));

    await stub.wakeAt(memberId, sooner);
    expect(await alarmOf(stub)).toBe(sooner.getTime());

    await stub.wakeAt(memberId, new Date("2031-01-03T00:00:00.000Z"));
    expect(await alarmOf(stub)).toBe(sooner.getTime());
  });

  // A tap on "wait 2 hours" can commit after the tick read her day and ask for a wake over RPC,
  // which the object accepts while the tick waits on the database. The tick then arms, and returns,
  // the later instant it computed from its earlier read: neither may replace the wake she asked for.
  it("keeps a sooner wake that a change asked for while the tick was running", async () => {
    const memberId = "member-raced";
    const asked = new Date("2031-01-01T08:00:00.000Z");
    const stale = new Date("2031-01-02T00:00:00.000Z");
    const stub = schedulerFor(memberId);
    await stub.wakeAt(memberId, new Date("2031-01-01T00:00:00.000Z"));
    const fake = createFakeRuntime({
      services: {
        tickMember: async (deps, id) => {
          await schedulerFor(id).wakeAt(id, asked);
          await deps.scheduler.wakeAt(id, stale);
          return stale;
        },
      },
    });

    expect(await runAlarm(stub, fake)).toBe(asked.getTime());
  });

  it("keeps a sooner wake asked for during a tick that threw, rather than the retry", async () => {
    const memberId = "member-raced-broken";
    const stub = schedulerFor(memberId);
    await stub.wakeAt(memberId, new Date("2031-01-01T00:00:00.000Z"));
    // Sooner than the retry a minute from now, and late enough not to fire while the file runs.
    const asked = new Date(Date.now() + 30_000);
    const fake = createFakeRuntime({
      services: {
        tickMember: async (_deps, id) => {
          await schedulerFor(id).wakeAt(id, asked);
          throw new Error("the database is away");
        },
      },
    });

    expect(await runAlarm(stub, fake)).toBe(asked.getTime());
  });

  it("wakeAt(null) deletes the alarm and everything the object stores", async () => {
    const memberId = "member-stopped";
    const stub = schedulerFor(memberId);
    await stub.wakeAt(memberId, new Date("2031-01-01T00:00:00.000Z"));

    await stub.wakeAt(memberId, null);

    const after = await runInDurableObject(stub, async (_instance, state) => ({
      alarm: await state.storage.getAlarm(),
      rows: (await state.storage.list()).size,
    }));
    expect(after.alarm).toBeNull();
    expect(after.rows).toBe(0);
  });

  it("does nothing when the alarm fires after the object was cleared", async () => {
    const memberId = "member-cleared";
    const fake = createFakeRuntime();
    const stub = schedulerFor(memberId);
    await stub.wakeAt(memberId, new Date("2031-01-01T00:00:00.000Z"));
    await stub.wakeAt(memberId, null);

    expect(await runAlarm(stub, fake)).toBeNull();
    expect(argsOf(fake.calls, "tickMember")).toEqual([]);
    expect(fake.built()).toBe(0);
  });
});
