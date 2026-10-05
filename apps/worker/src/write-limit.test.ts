import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { PilotEnv } from "./env.ts";
import { testEnv } from "./testing/fakes.ts";
import {
  type AccountWriteLimiter,
  ADMITTED_KEY,
  WRITE_LIMIT,
  writeLimiterOf,
} from "./write-limit.ts";

const PERIOD_MS = WRITE_LIMIT.periodSeconds * 1000;

/** The limiter objects wrangler.jsonc binds in development, which the tests' runtime is built from. */
function limiters(): NonNullable<PilotEnv["ACCOUNT_WRITE_LIMITER"]> {
  const namespace = testEnv.ACCOUNT_WRITE_LIMITER;
  if (namespace === undefined) {
    throw new Error("wrangler.jsonc binds no ACCOUNT_WRITE_LIMITER in development");
  }
  return namespace;
}

/** A fresh account's own limiter, so no test sees another's count. */
function freshLimiter(): DurableObjectStub<AccountWriteLimiter> {
  return writeLimiterOf(limiters(), `user_${crypto.randomUUID()}`);
}

/** Asks the limiter `count` times, one after the other, and returns its answers in order. */
async function admitInTurn(
  limiter: DurableObjectStub<AccountWriteLimiter>,
  count: number,
): Promise<boolean[]> {
  const answers: boolean[] = [];
  for (let i = 0; i < count; i += 1) {
    answers.push(await limiter.admit());
  }
  return answers;
}

/** What the object stores: the times of its counted writes, or undefined once it is cleared. */
function stored(limiter: DurableObjectStub<AccountWriteLimiter>): Promise<unknown> {
  return runInDurableObject(limiter, (_, state) => state.storage.kv.get(ADMITTED_KEY));
}

/** The time the object's alarm is set for, or null. */
function alarmOf(limiter: DurableObjectStub<AccountWriteLimiter>): Promise<number | null> {
  return runInDurableObject(limiter, (_, state) => state.storage.getAlarm());
}

/** Moves the first `count` counted writes back to a period and a second ago. */
async function ageOldest(
  limiter: DurableObjectStub<AccountWriteLimiter>,
  count: number,
): Promise<void> {
  await runInDurableObject(limiter, (_, state) => {
    const times = state.storage.kv.get<number[]>(ADMITTED_KEY) ?? [];
    const old = Date.now() - PERIOD_MS - 1000;
    state.storage.kv.put(
      ADMITTED_KEY,
      times.map((at, index) => (index < count ? old : at)),
    );
  });
}

function repeat<T>(value: T, count: number): T[] {
  return Array<T>(count).fill(value);
}

describe("the per-account write limit", () => {
  it("admits an account's first 20 writes in a minute and refuses every one after them", async () => {
    const answers = await admitInTurn(freshLimiter(), WRITE_LIMIT.limit + 5);

    expect(WRITE_LIMIT).toEqual({ limit: 20, periodSeconds: 60 });
    expect(answers).toEqual([...repeat(true, 20), ...repeat(false, 5)]);
  });

  it("counts each account alone: one over its limit refuses no other account's write", async () => {
    const spent = freshLimiter();
    await admitInTurn(spent, WRITE_LIMIT.limit);

    expect(await spent.admit()).toBe(false);
    expect(await freshLimiter().admit()).toBe(true);
    expect(await spent.admit()).toBe(false);
  });

  // The object answers one call at a time and reads and writes its count with nothing in between,
  // so a burst sent all at once is counted as exactly as one sent in turn.
  it("admits exactly 20 of 40 writes sent at the same moment", async () => {
    const limiter = freshLimiter();

    const answers = await Promise.all(repeat(null, 40).map(() => limiter.admit()));

    expect(answers.filter((admitted) => admitted)).toHaveLength(20);
    expect(await stored(limiter)).toHaveLength(20);
  });

  // A count held in memory would start again at zero in every new instance of the object.
  it("keeps the count when the object is evicted: it is stored, not held in memory", async () => {
    const limiter = freshLimiter();
    await admitInTurn(limiter, WRITE_LIMIT.limit);

    await evictDurableObject(limiter);

    expect(await limiter.admit()).toBe(false);
  });

  it("counts no refused write, so trying again does not push the account's next write further off", async () => {
    const limiter = freshLimiter();
    await admitInTurn(limiter, WRITE_LIMIT.limit);
    const before = await stored(limiter);

    await admitInTurn(limiter, 5);

    expect(await stored(limiter)).toEqual(before);
  });

  // A window over the last minute, not a fixed minute: an account cannot spend 20 writes at the end
  // of one minute and 20 more at the start of the next.
  it("admits again as each counted write becomes a period old, and no sooner", async () => {
    const limiter = freshLimiter();
    await admitInTurn(limiter, WRITE_LIMIT.limit);

    await ageOldest(limiter, 5);

    expect(await admitInTurn(limiter, 6)).toEqual([...repeat(true, 5), false]);
    expect(await stored(limiter)).toHaveLength(20);
  });
});

describe("what the write limit keeps", () => {
  it("stores only when each counted write was admitted, and sets one alarm, a period after the first", async () => {
    const limiter = freshLimiter();
    const before = Date.now();

    await admitInTurn(limiter, 3);

    const times = await stored(limiter);
    expect(times).toEqual([expect.any(Number), expect.any(Number), expect.any(Number)]);
    const [first = 0] = times as number[];
    expect(first).toBeGreaterThanOrEqual(before);
    expect(await alarmOf(limiter)).toBe(first + PERIOD_MS);
  });

  it("keeps the times still within the period when its alarm runs, and clears them a period after the newest", async () => {
    const limiter = freshLimiter();
    await admitInTurn(limiter, 3);
    await ageOldest(limiter, 2);
    const newest = ((await stored(limiter)) as number[])[2] ?? 0;

    expect(await runDurableObjectAlarm(limiter)).toBe(true);

    expect(await stored(limiter)).toEqual([newest]);
    expect(await alarmOf(limiter)).toBe(newest + PERIOD_MS);
  });

  // An account deleted from Vela leaves nothing here to erase, a minute after its last write.
  it("clears everything once every counted write is a period old, leaving no alarm", async () => {
    const limiter = freshLimiter();
    await admitInTurn(limiter, 3);
    await ageOldest(limiter, 3);

    expect(await runDurableObjectAlarm(limiter)).toBe(true);

    expect(await stored(limiter)).toBeUndefined();
    expect(await alarmOf(limiter)).toBeNull();
    expect(await limiter.admit()).toBe(true);
  });
});
