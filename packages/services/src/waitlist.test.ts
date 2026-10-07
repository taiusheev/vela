import { waitlistSignups } from "@vela/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./testing/harness.ts";
import { joinWaitlist, loadWaitlist, WaitlistInput } from "./waitlist.ts";

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

describe("WaitlistInput", () => {
  it("keeps an address trimmed and lowercased", () => {
    expect(WaitlistInput.parse({ email: "  Mia@Example.COM ", lang: "zh-TW", role: null })).toEqual(
      {
        email: "mia@example.com",
        lang: "zh-TW",
        role: null,
      },
    );
  });

  it.each(["", "mia", "mia@", "@example.com", `${"a".repeat(250)}@example.com`])(
    "refuses %j as an address",
    (email) => {
      expect(WaitlistInput.safeParse({ email, lang: "en", role: null }).success).toBe(false);
    },
  );

  it("refuses a language or role the site does not offer", () => {
    expect(WaitlistInput.safeParse({ email: "a@b.co", lang: "fr", role: null }).success).toBe(
      false,
    );
    expect(WaitlistInput.safeParse({ email: "a@b.co", lang: "en", role: "admin" }).success).toBe(
      false,
    );
  });
});

describe("joinWaitlist", () => {
  it("keeps an address once however often it is sent, first answer kept", async () => {
    await joinWaitlist(h.db, { email: "mia@example.com", lang: "en", role: "organiser" });
    await joinWaitlist(h.db, { email: "mia@example.com", lang: "zh-TW", role: "parent" });

    const rows = await h.db.select().from(waitlistSignups);
    expect(rows.map((row) => [row.email, row.language, row.role])).toEqual([
      ["mia@example.com", "en", "organiser"],
    ]);
  });

  it("refuses an address that was not lowercased, at the database too", async () => {
    await expect(
      h.db.insert(waitlistSignups).values({ email: "Mia@example.com", language: "en" }),
    ).rejects.toThrow();
  });
});

describe("loadWaitlist", () => {
  it("counts by language and lists the newest first", async () => {
    await joinWaitlist(h.db, { email: "a@example.com", lang: "en", role: null });
    await joinWaitlist(h.db, { email: "b@example.com", lang: "zh-TW", role: "parent" });
    await joinWaitlist(h.db, { email: "c@example.com", lang: "zh-TW", role: "organiser" });

    const list = await loadWaitlist(h.db);

    expect(list.total).toBe(3);
    expect(list.byLanguage).toEqual({ en: 1, "zh-TW": 2 });
    expect(list.latest.map((row) => row.email)).toEqual([
      "c@example.com",
      "b@example.com",
      "a@example.com",
    ]);
  });
});
