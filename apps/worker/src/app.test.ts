import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import type { Env } from "./env.ts";
import {
  argsOf,
  createFakeRuntime,
  type FakeRuntime,
  familyPageFixture,
  inboundEventFixture,
  namesOf,
  testEnv,
} from "./testing/fakes.ts";

const ORIGIN = "https://worker.test";

/**
 * The Worker as it is deployed: `PUBLIC_BASE_URL` is the origin the founder's browser loaded the
 * admin page from, which is the only origin a form may be posted from (§9). A test about that rule
 * passes an environment whose base URL is somewhere else.
 */
const adminEnv: Env = { ...testEnv, PUBLIC_BASE_URL: ORIGIN };

async function send(
  app: ReturnType<typeof createApp>,
  request: Request,
  env: Env = adminEnv,
): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await app.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

function webhookRequest(secret: string | null): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (secret !== null) {
    headers.set("X-Telegram-Bot-Api-Secret-Token", secret);
  }
  return new Request(`${ORIGIN}/webhooks/telegram`, {
    method: "POST",
    headers,
    body: JSON.stringify({ update_id: 1 }),
  });
}

function formRequest(path: string, form: Record<string, string>, origin: string | null): Request {
  const body = new URLSearchParams(form);
  const headers = new Headers({ "content-type": "application/x-www-form-urlencoded" });
  if (origin !== null) {
    headers.set("Origin", origin);
  }
  return new Request(`${ORIGIN}${path}`, { method: "POST", headers, body });
}

function appFor(fake: FakeRuntime): ReturnType<typeof createApp> {
  return createApp(fake.runtime);
}

describe("the Telegram webhook", () => {
  it("refuses a request whose secret does not match and hands nothing to the router", async () => {
    const fake = createFakeRuntime({ webhookSecret: "right", events: [inboundEventFixture()] });
    const response = await send(appFor(fake), webhookRequest("wrong"));

    expect(response.status).toBe(401);
    expect(namesOf(fake.calls)).toEqual([]);
  });

  it("refuses a request with no secret header at all", async () => {
    const fake = createFakeRuntime({ webhookSecret: "right" });
    expect((await send(appFor(fake), webhookRequest(null))).status).toBe(401);
  });

  it("hands the parsed events to the router and answers 200", async () => {
    const event = inboundEventFixture({ eventId: "telegram:77", text: "hello" });
    const fake = createFakeRuntime({ webhookSecret: "right", events: [event] });

    const response = await send(appFor(fake), webhookRequest("right"));

    expect(response.status).toBe(200);
    expect(fake.inbound).toEqual([event]);
    expect(fake.closed()).toBe(fake.built());
  });

  it("builds no deps when the update parsed to nothing", async () => {
    const fake = createFakeRuntime({ webhookSecret: "right", events: [] });

    expect((await send(appFor(fake), webhookRequest("right"))).status).toBe(200);
    expect(fake.built()).toBe(0);
  });

  it("answers 500 when the router throws, so Telegram redelivers", async () => {
    const fake = createFakeRuntime({
      webhookSecret: "right",
      events: [inboundEventFixture()],
      services: {
        handleInbound: async () => {
          throw new Error("database is away");
        },
      },
    });

    expect((await send(appFor(fake), webhookRequest("right"))).status).toBe(500);
    expect(fake.closed()).toBe(1);
  });
});

describe("the admin pages", () => {
  it("answers /healthz without an identity", async () => {
    const fake = createFakeRuntime({ admin: null });
    expect((await send(appFor(fake), new Request(`${ORIGIN}/healthz`))).status).toBe(200);
  });

  it("refuses the overview without a valid Access token and reads nothing", async () => {
    const fake = createFakeRuntime({ admin: null });

    const response = await send(appFor(fake), new Request(`${ORIGIN}/admin`));

    expect(response.status).toBe(401);
    expect(namesOf(fake.calls)).toEqual([]);
  });

  it("reads the overview as the identity in the token", async () => {
    const fake = createFakeRuntime({ admin: "founder@vela.test" });

    const response = await send(appFor(fake), new Request(`${ORIGIN}/admin`));

    expect(response.status).toBe(200);
    expect(argsOf(fake.calls, "loadAdminOverview")).toEqual([[{ admin: "founder@vela.test" }]]);
  });

  it("answers 404 for a family that is not recorded", async () => {
    const fake = createFakeRuntime();
    const response = await send(
      appFor(fake),
      new Request(`${ORIGIN}/admin/families/11111111-1111-7111-8111-111111111111`),
    );

    expect(response.status).toBe(404);
  });

  it("answers 400 for an address that is not a family id, without failing the request", async () => {
    const refusal = Object.assign(new Error("view: 'not-a-uuid' is not a uuid"), {
      name: "VelaError",
      code: "invalid_payload",
    });
    const fake = createFakeRuntime({
      services: {
        loadFamilyPage: async () => {
          throw refusal;
        },
      },
    });

    const response = await send(appFor(fake), new Request(`${ORIGIN}/admin/families/not-a-uuid`));

    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("is not a uuid");
    expect(fake.closed()).toBe(fake.built());
  });

  it("escapes what a family wrote into its own name", async () => {
    const page = familyPageFixture();
    page.family.name = '<script>alert("x")</script>';
    const fake = createFakeRuntime({ services: { loadFamilyPage: async () => page } });

    const response = await send(
      appFor(fake),
      new Request(`${ORIGIN}/admin/families/${page.family.id}`),
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).not.toContain("<script>alert");
    expect(body).toContain("&lt;script&gt;");
  });
});

describe("an admin action", () => {
  const memberId = "22222222-2222-7222-8222-222222222222";
  const familyId = "11111111-1111-7111-8111-111111111111";
  const path = `/admin/families/${familyId}/mark_left`;

  it("refuses a post with no Origin header", async () => {
    const fake = createFakeRuntime();

    const response = await send(appFor(fake), formRequest(path, { memberId }, null));

    expect(response.status).toBe(403);
    expect(namesOf(fake.calls)).toEqual([]);
  });

  it("refuses a post from another origin", async () => {
    const fake = createFakeRuntime();

    const response = await send(
      appFor(fake),
      formRequest(path, { memberId }, "https://elsewhere.example"),
    );

    expect(response.status).toBe(403);
    expect(namesOf(fake.calls)).toEqual([]);
  });

  it("refuses a post whose Origin is the hostname it arrived on rather than the public base", async () => {
    const fake = createFakeRuntime();
    const deployed: Env = { ...testEnv, PUBLIC_BASE_URL: "https://vela.family" };

    const response = await send(appFor(fake), formRequest(path, { memberId }, ORIGIN), deployed);

    expect(response.status).toBe(403);
    expect(namesOf(fake.calls)).toEqual([]);
  });

  it("accepts a post from the public base, whichever hostname it arrived on", async () => {
    const fake = createFakeRuntime();
    const deployed: Env = { ...testEnv, PUBLIC_BASE_URL: "https://vela.family" };

    const response = await send(
      appFor(fake),
      formRequest(path, { memberId, confirm: "left" }, "https://vela.family"),
      deployed,
    );

    expect(response.status).toBe(303);
  });

  it("changes nothing when PUBLIC_BASE_URL is not a URL: that is a misconfigured deployment", async () => {
    const fake = createFakeRuntime();
    const misconfigured: Env = { ...testEnv, PUBLIC_BASE_URL: "vela.family" };

    const response = await send(
      appFor(fake),
      formRequest(path, { memberId }, ORIGIN),
      misconfigured,
    );

    expect(response.status).toBe(500);
    expect(namesOf(fake.calls)).toEqual([]);
  });

  it("refuses a post without a valid Access token", async () => {
    const fake = createFakeRuntime({ admin: null });

    const response = await send(appFor(fake), formRequest(path, { memberId }, ORIGIN));

    expect(response.status).toBe(401);
    expect(namesOf(fake.calls)).toEqual([]);
  });

  it("calls the action with the Access identity and the family it was posted from", async () => {
    const fake = createFakeRuntime({ admin: "founder@vela.test" });

    const response = await send(
      appFor(fake),
      formRequest(path, { memberId, confirm: "left" }, ORIGIN),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/admin/families/${familyId}?result=done`);
    expect(argsOf(fake.calls, "markLeft")).toEqual([
      [{ admin: "founder@vela.test", familyId }, memberId],
    ]);
  });

  it("sends the weekly read as the founder edited it and says what came back", async () => {
    const weeklyReadId = "33333333-3333-7333-8333-333333333333";
    const fake = createFakeRuntime({ services: { sendWeeklyRead: async () => "budget" } });

    const response = await send(
      appFor(fake),
      formRequest(
        `/admin/families/${familyId}/send_weekly_read`,
        {
          weeklyReadId,
          lines: "She walked to the market.\n\nThe cat is well.\n",
          suggestion: "Ask about the market",
        },
        ORIGIN,
      ),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/admin/families/${familyId}?result=budget`);
    expect(argsOf(fake.calls, "sendWeeklyRead")).toEqual([
      [
        { admin: "founder@vela.test", familyId },
        {
          weeklyReadId,
          lines: ["She walked to the market.", "The cat is well."],
          suggestion: "Ask about the market",
        },
      ],
    ]);
  });

  it("deletes a family only when the word is typed", async () => {
    const fake = createFakeRuntime();

    const refused = await send(
      appFor(fake),
      formRequest(`/admin/families/${familyId}/delete_family`, { confirm: "" }, ORIGIN),
    );
    expect(refused.status).toBe(400);
    expect(namesOf(fake.calls)).toEqual([]);

    const accepted = await send(
      appFor(fake),
      formRequest(`/admin/families/${familyId}/delete_family`, { confirm: "delete" }, ORIGIN),
    );
    expect(accepted.status).toBe(303);
    expect(argsOf(fake.calls, "deleteFamily")).toEqual([
      [{ admin: "founder@vela.test", familyId }, familyId],
    ]);
  });

  // For the kept-light member a departure cannot be undone, and which member that is lives in the
  // database, so every departure is typed out.
  it("marks a member left only when the departure is typed out", async () => {
    const fake = createFakeRuntime();

    for (const confirm of [null, "", "yes"]) {
      const form: Record<string, string> = confirm === null ? { memberId } : { memberId, confirm };
      const refused = await send(appFor(fake), formRequest(path, form, ORIGIN));
      expect(refused.status).toBe(400);
    }
    expect(namesOf(fake.calls)).toEqual([]);

    const accepted = await send(
      appFor(fake),
      formRequest(path, { memberId, confirm: "left" }, ORIGIN),
    );
    expect(accepted.status).toBe(303);
    expect(argsOf(fake.calls, "markLeft")).toEqual([
      [{ admin: "founder@vela.test", familyId }, memberId],
    ]);
  });

  describe("a consent form", () => {
    const contactId = "44444444-4444-7444-8444-444444444444";
    const contactConsent = {
      contactId,
      answer: "yes",
      at: "2026-09-14T08:30",
      textVersion: "pilot-2026-09",
      lang: "zh-TW",
      channel: "telegram",
      note: "said yes on the onboarding call",
    };
    const memberConsent = {
      memberId,
      kind: "privacy_notice",
      givenAt: "2026-09-14T08:30",
      textVersion: "pilot-2026-09",
      lang: "en",
      channel: "telegram",
      note: "read to her on the call",
    };

    // A contact is listed in quiet notices only after they said yes themselves: an answer the page
    // could not have sent is refused, never read as the yes.
    it("refuses a contact answer the page does not offer instead of recording a yes", async () => {
      const fake = createFakeRuntime();
      const contactPath = `/admin/families/${familyId}/record_contact_consent`;

      for (const answer of ["", "Yes", "maybe"]) {
        const response = await send(
          appFor(fake),
          formRequest(contactPath, { ...contactConsent, answer }, ORIGIN),
        );
        expect(response.status).toBe(400);
      }
      const unanswered = Object.fromEntries(
        Object.entries(contactConsent).filter(([name]) => name !== "answer"),
      );
      expect((await send(appFor(fake), formRequest(contactPath, unanswered, ORIGIN))).status).toBe(
        400,
      );
      expect(namesOf(fake.calls)).toEqual([]);

      const declined = await send(
        appFor(fake),
        formRequest(contactPath, { ...contactConsent, answer: "no" }, ORIGIN),
      );
      expect(declined.status).toBe(303);
      expect(argsOf(fake.calls, "recordContactConsent")).toEqual([
        [
          { admin: "founder@vela.test", familyId },
          {
            contactId,
            answer: "no",
            at: new Date("2026-09-14T08:30:00.000Z"),
            textVersion: "pilot-2026-09",
            lang: "zh-TW",
            channel: "telegram",
            evidence: { note: "said yes on the onboarding call" },
          },
        ],
      ]);
    });

    it("refuses a language the page does not offer instead of recording English", async () => {
      const fake = createFakeRuntime();

      const contact = await send(
        appFor(fake),
        formRequest(
          `/admin/families/${familyId}/record_contact_consent`,
          { ...contactConsent, lang: "ja" },
          ORIGIN,
        ),
      );
      const member = await send(
        appFor(fake),
        formRequest(
          `/admin/families/${familyId}/record_consent`,
          { ...memberConsent, lang: "" },
          ORIGIN,
        ),
      );

      expect([contact.status, member.status]).toEqual([400, 400]);
      expect(namesOf(fake.calls)).toEqual([]);
    });

    it("refuses a consent kind the page does not offer instead of recording the pilot consent", async () => {
      const fake = createFakeRuntime();
      const consentPath = `/admin/families/${familyId}/record_consent`;

      for (const kind of ["", "nearby"]) {
        const response = await send(
          appFor(fake),
          formRequest(consentPath, { ...memberConsent, kind }, ORIGIN),
        );
        expect(response.status).toBe(400);
      }
      expect(namesOf(fake.calls)).toEqual([]);

      const recorded = await send(appFor(fake), formRequest(consentPath, memberConsent, ORIGIN));
      expect(recorded.status).toBe(303);
      expect(argsOf(fake.calls, "recordConsent")).toEqual([
        [
          { admin: "founder@vela.test", familyId },
          {
            memberId,
            kind: "privacy_notice",
            textVersion: "pilot-2026-09",
            lang: "en",
            channel: "telegram",
            givenAt: new Date("2026-09-14T08:30:00.000Z"),
            evidence: { note: "read to her on the call" },
          },
        ],
      ]);
    });
  });

  it("answers 404 for an address that is not an action", async () => {
    const fake = createFakeRuntime();

    const response = await send(
      appFor(fake),
      formRequest(`/admin/families/${familyId}/burn_everything`, {}, ORIGIN),
    );

    expect(response.status).toBe(404);
    expect(namesOf(fake.calls)).toEqual([]);
  });

  it("turns a refusal from services into a status, not a stack trace", async () => {
    const refusal = Object.assign(new Error("not in this family"), {
      name: "VelaError",
      code: "not_found",
    });
    const fake = createFakeRuntime({
      services: {
        markLeft: async () => {
          throw refusal;
        },
      },
    });

    const response = await send(
      appFor(fake),
      formRequest(path, { memberId, confirm: "left" }, ORIGIN),
    );

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("not in this family");
  });
});
