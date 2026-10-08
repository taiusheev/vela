import { deadLetters } from "@vela/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  claimDeadLetterReplays,
  keepDeadLetter,
  loadDeadLetters,
  releaseDeadLetterReplay,
  requestDeadLetterReplay,
} from "./dead-letters.ts";
import { applyRetention } from "./jobs.ts";
import { opsAlerts } from "./ops.ts";
import { createHarness, type Harness } from "./testing/harness.ts";

let h: Harness;
const DAY = 24 * 60 * 60 * 1000;
const INBOUND = { type: "handle_inbound", events: [{ text: "我跌倒了" }] };

beforeAll(async () => {
  h = await createHarness();
}, 60_000);
beforeEach(async () => {
  await h.reset();
});
afterAll(async () => {
  await h.close();
});

async function keep(messageId = "m-1") {
  return keepDeadLetter(h.deps, { messageId, jobType: "handle_inbound", job: INBOUND });
}

describe("dead letters", () => {
  it("keeps a dead job once, however often the queue delivers it", async () => {
    expect(await keep()).toBe(true);
    expect(await keep()).toBe(false);
    const rows = await loadDeadLetters(h.deps);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ jobType: "handle_inbound", replayRequestedAt: null });
    // The overview's rows carry no content.
    expect(JSON.stringify(rows)).not.toContain("跌倒");
  });

  it("seals the job: its words are not readable in the column", async () => {
    await keep();
    const raw = await h.db.execute<{ job: unknown }>("select job::text as job from dead_letters");
    expect(JSON.stringify(raw)).not.toContain("跌倒");
  });

  it("replays a requested job once, and gives it back when the send fails", async () => {
    await keep();
    const [row] = await loadDeadLetters(h.deps);
    if (row === undefined) throw new Error("expected a row");
    expect(await claimDeadLetterReplays(h.deps)).toEqual([]);

    expect(await requestDeadLetterReplay(h.deps, row.id)).toBe("requested");
    expect(await requestDeadLetterReplay(h.deps, row.id)).toBe("already");
    expect(await requestDeadLetterReplay(h.deps, crypto.randomUUID())).toBe("not_found");
    expect(await requestDeadLetterReplay(h.deps, "not-a-uuid")).toBe("not_found");

    const claimed = await claimDeadLetterReplays(h.deps);
    expect(claimed).toEqual([{ id: row.id, jobType: "handle_inbound", job: INBOUND }]);
    expect(await claimDeadLetterReplays(h.deps)).toEqual([]);

    await releaseDeadLetterReplay(h.deps, row.id);
    expect(await claimDeadLetterReplays(h.deps)).toHaveLength(1);
  });

  it("deletes dead jobs after 14 days in the nightly retention", async () => {
    await keep("old");
    h.clock.advance(15 * DAY);
    await keep("new");
    const counts = await applyRetention(h.deps);
    expect(counts.dead_letters_deleted).toBe(1);
    expect((await h.db.select({ id: deadLetters.id }).from(deadLetters)).length).toBe(1);
  });

  it("tells the founder once an hour that jobs were kept as dead letters", async () => {
    await keep("a");
    await keep("b");
    expect(await opsAlerts(h.deps)).toBe(1);
    const [text] = h.telegram.sentTo("9001").map((entry) => entry.message.text ?? "");
    expect(text).toMatch(/^2 queue jobs failed every retry since/);
    expect(await opsAlerts(h.deps)).toBe(0);
  });
});
