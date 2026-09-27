import type { ChannelQuota } from "@vela/contracts";
import { flags } from "@vela/db";
import { asc } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { VelaError } from "./errors.ts";
import { recordChannelQuota } from "./quota.ts";
import { createHarness, type Harness } from "./testing/harness.ts";

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

/** The founder's chat with the bot, the harness's admin conversation. */
const ADMIN = "9001";

/** 中用量's monthly allowance (05-line-flows.md fact 16). */
const LIMIT = 3000;

const OVERVIEW = "https://vela.test/admin";

/** A reading of `used` messages against the plan's limit, read mid-October in Taipei. */
function reading(used: number, overrides: Partial<ChannelQuota> = {}): ChannelQuota {
  return { limit: LIMIT, used, readAt: "2026-10-12T09:30:00.000+08:00", ...overrides };
}

function founderTexts(): string[] {
  return h.telegram.sentTo(ADMIN).map((entry) => entry.message.text);
}

function crossed(used: number): string {
  return `LINE has used ${used} of this month's ${LIMIT} messages. Open: ${OVERVIEW}`;
}

const SPENT = `LINE has used all of this month's messages: mornings and notices on LINE fail until the plan changes or the month ends, and only replies still go out. Open: ${OVERVIEW}`;

async function flagRows() {
  return h.db.select().from(flags).orderBy(asc(flags.key));
}

describe("recordChannelQuota", () => {
  it("keeps the reading as LINE's quota, replacing the one before, and tells nobody below 70%", async () => {
    await recordChannelQuota(h.deps, "line", reading(1200));
    h.clock.advanceMinutes(15);
    await recordChannelQuota(
      h.deps,
      "line",
      reading(2099, { readAt: "2026-10-12T09:45:00.000+08:00" }),
    );

    expect(await flagRows()).toEqual([
      {
        key: "line_quota",
        value: { limit: LIMIT, used: 2099, readAt: "2026-10-12T09:45:00.000+08:00" },
        updatedAt: h.clock.now(),
      },
    ]);
    expect(founderTexts()).toEqual([]);
  });

  it("tells the founder once at 70% of the month's limit, with the count and the overview's link alone", async () => {
    await recordChannelQuota(h.deps, "line", reading(2100));
    await recordChannelQuota(h.deps, "line", reading(2400));

    expect(founderTexts()).toEqual([crossed(2100)]);
    expect(h.telegram.sentTo(ADMIN)[0]?.message).toMatchObject({
      kind: "system",
      lang: "en",
      to: { channel: "telegram", conversationId: ADMIN },
      idempotencyKey: "line_quota:2026-10:70",
    });
  });

  it("tells the founder again at 90%, once", async () => {
    await recordChannelQuota(h.deps, "line", reading(2100));
    await recordChannelQuota(h.deps, "line", reading(2700));
    await recordChannelQuota(h.deps, "line", reading(2950));

    expect(founderTexts()).toEqual([crossed(2100), crossed(2700)]);
  });

  it("tells the founder once when the month's messages are spent, without the 90% before it", async () => {
    await recordChannelQuota(h.deps, "line", reading(3000));
    await recordChannelQuota(h.deps, "line", reading(3004));

    expect(founderTexts()).toEqual([SPENT]);
  });

  it("tells only the highest level a reading reached, then each level above it as it comes", async () => {
    await recordChannelQuota(h.deps, "line", reading(2800));
    await recordChannelQuota(h.deps, "line", reading(2900));
    await recordChannelQuota(h.deps, "line", reading(3000));

    expect(founderTexts()).toEqual([crossed(2800), SPENT]);
    expect((await flagRows()).map((row) => row.key)).toEqual([
      "line_quota",
      "line_quota:2026-10:90",
      "line_quota:2026-10:exhausted",
    ]);
  });

  it("tells the founder again in the next quota month, which turns at midnight in Taipei", async () => {
    await recordChannelQuota(h.deps, "line", reading(2100, { readAt: "2026-10-31T15:59:00.000Z" }));
    await recordChannelQuota(h.deps, "line", reading(2200, { readAt: "2026-10-31T16:00:00.000Z" }));

    expect(founderTexts()).toEqual([crossed(2100), crossed(2200)]);
    expect((await flagRows()).map((row) => row.key)).toEqual([
      "line_quota",
      "line_quota:2026-10:70",
      "line_quota:2026-11:70",
    ]);
  });

  it("keeps a reading with no limit and tells nobody", async () => {
    await recordChannelQuota(h.deps, "line", reading(90_000, { limit: null }));

    expect((await flagRows()).map((row) => [row.key, row.value])).toEqual([
      ["line_quota", { limit: null, used: 90_000, readAt: "2026-10-12T09:30:00.000+08:00" }],
    ]);
    expect(founderTexts()).toEqual([]);
  });

  it("tries a send that failed for a reason that can pass again at the next reading", async () => {
    h.telegram.failNextSends(1, "unavailable");

    await recordChannelQuota(h.deps, "line", reading(2100));

    expect(founderTexts()).toEqual([]);
    expect(h.telegram.failed).toHaveLength(1);
    expect((await flagRows()).map((row) => row.key)).toEqual(["line_quota"]);
    expect(h.logger.entries).toContainEqual({
      level: "warn",
      event: "channel_quota_alert_failed",
      fields: { channel: "line", level: "70", code: "unavailable" },
    });

    await recordChannelQuota(h.deps, "line", reading(2150));
    await recordChannelQuota(h.deps, "line", reading(2200));

    expect(founderTexts()).toEqual([crossed(2150)]);
  });

  it("does not try again this month a send the platform refused for good", async () => {
    h.telegram.failNextSends(1, "blocked");

    await recordChannelQuota(h.deps, "line", reading(2100));
    await recordChannelQuota(h.deps, "line", reading(2150));

    expect(founderTexts()).toEqual([]);
    expect(h.telegram.failed).toHaveLength(1);
    expect(h.logger.entries).toContainEqual({
      level: "warn",
      event: "channel_quota_alert_refused",
      fields: { channel: "line", level: "70", code: "blocked" },
    });
  });

  it("claims nothing without an admin conversation, so the founder hears once one is set", async () => {
    const configured = h.config.adminConversationId;
    h.config.adminConversationId = null;
    try {
      await recordChannelQuota(h.deps, "line", reading(2100));
    } finally {
      h.config.adminConversationId = configured;
    }

    expect((await flagRows()).map((row) => row.key)).toEqual(["line_quota"]);
    expect(founderTexts()).toEqual([]);

    await recordChannelQuota(h.deps, "line", reading(2150));

    expect(founderTexts()).toEqual([crossed(2150)]);
  });

  it.each([
    ["a negative count", reading(-1)],
    ["a count that is not whole", reading(2100.5)],
    ["a time without its offset", reading(2100, { readAt: "2026-10-12T09:30:00" })],
  ])("refuses %s, keeping the reading before it and telling nobody", async (_case, bad) => {
    await recordChannelQuota(h.deps, "line", reading(1200));

    const refusal = recordChannelQuota(h.deps, "line", bad);
    await expect(refusal).rejects.toBeInstanceOf(VelaError);
    await expect(refusal).rejects.toMatchObject({ code: "invalid_payload" });

    expect((await flagRows()).map((row) => row.value)).toEqual([
      { limit: LIMIT, used: 1200, readAt: "2026-10-12T09:30:00.000+08:00" },
    ]);
    expect(founderTexts()).toEqual([]);
  });
});
